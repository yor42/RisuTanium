import { language } from "src/lang"
import { fillLang } from "src/lang/fill"
import { alertClear, alertConfirm, alertModuleSelect, alertNormal, alertStore, alertWait } from "../alert"
import { getCurrentCharacter, getDatabase, setCurrentCharacter, setDatabase, type customscript, type loreBook, type triggerscript } from "../storage/database.svelte"
import type { RunSubject } from "./chatOrigin"
import { ASSET_PIECE_SAVE_MIN_BYTES } from "../assetHash"
import { AppendableBuffer, AssetSourceChangedError, downloadFile, forageStorage, LocalWriter, readImage, saveAsset, saveAssetFromPieces, VirtualWriter } from "../globalApi.svelte"
import { checkPersonaBinded, selectFileByDom, sleep } from "../util"
import { v4 } from "uuid"
import { convertExternalLorebook } from "./lorebook.svelte"
import { compressImage } from '../media'
import { decodeRPack, encodeRPack } from "../rpack/rpack_js"
import { DBState, HideIconStore, moduleBackgroundEmbedding, ReloadGUIPointer } from "../stores.svelte"
import {get} from "svelte/store"
import { convertCharacterToModule, convertModuleToCharacter } from "../interchangeability"
import { exportCharacterCard, importCharacterFile, preflightCardExport } from "../characterCards"
import { appStoreOrNull, listModuleAssets, preflightExport, refuseExport } from "../drive/exportPreflight"
import { moduleListOf, moduleRefIdsOf } from "./moduleRefList"
import { bumpModuleGui } from "./moduleGuiBump"
import { ModuleRefusal } from "./moduleRefusal"
import { ModuleImportStopped, confirmRisumLowLevel } from "./moduleImportStop"
import { outcomeOfError, runImportBatch, showOutcome, type ImportOutcome } from "../importBatch"
import { markBootWrite } from "../bootWindow"
import { useModuleById } from "./moduleUse"
import { hasModuleStubKey, isModuleStub } from "../storage/moduleStub"
import { DuplicateSession, applyModulePlacement, describeReplace, type DuplicateDecision } from "./moduleDuplicates"
import { withBusy } from "./memory/busyActions"
import { StoreBlobUnsupportedError } from "../storage/store/errors"
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
}

export function exportModule(module:RisuModule, arg:{
    alertEnd?:boolean
} = {}){
    return withBusy('export', () => writeModuleCard(module, arg))
}

async function writeModuleCard(module:RisuModule, arg:{
    alertEnd?:boolean
}){
    const alertEnd = arg.alertEnd ?? true

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
    const writer = new LocalWriter()
    if(!(await writer.init(module.name + '.module', ['charx']))){
        //the person cancelled the save dialog
        return
    }
    const exported = await exportCharacterCard(char, 'charx', {
        spec: 'v3',
        writer,
        checked
    })
    if(!exported){
        //the export already showed its error; a success alert would hide it
        return
    }
    if(alertEnd){
        alertNormal(language.successExport)
    }
}

export async function exportModuleLegacy(module:RisuModule, arg:{
    alertEnd?:boolean
    saveData?:boolean
} = {}){
    const alertEnd = arg.alertEnd ?? true
    const saveData = arg.saveData ?? true
    const apb = new AppendableBuffer()
    const writeLength = (len:number) => {
        const lenbuf = Buffer.alloc(4)
        lenbuf.writeUInt32LE(len, 0)
        apb.append(lenbuf)
    }
    const writeByte = (byte:number) => {
        //byte is 0-255
        const buf = Buffer.alloc(1)
        buf.writeUInt8(byte, 0)
        apb.append(buf)
    }

    const entries = listModuleAssets(module)
    if(entries.length > 0 && await refuseExport(await preflightExport(entries, 'risum', appStoreOrNull))){
        return null
    }
    module = safeStructuredClone(module)
    module.assets ??= []
    module.assets = module.assets.map((asset) => {
        return [asset[0], '', asset[2]] as [string,string,string]
    })

    const mainbuf = await encodeRPack(Buffer.from(JSON.stringify({
        module: module,
        type: 'risuModule'
    }, null, 2), 'utf-8'))

    writeByte(111) //magic number
    writeByte(0) //version
    writeLength(mainbuf.length)
    apb.append(mainbuf)

    for(const entry of entries){
        writeByte(1) //mark as asset
        alertStore.set({
            type: 'wait',
            msg: fillLang(language.alerts.addingAssets, { completed: entry.index, total: entries.length })
        })
        let rData = await readImage(entry.key)
        if(!rData){
            rData = new Uint8Array(0) //blank buffer
        }
        let encoded = await encodeRPack(Buffer.from(await compressImage(rData)))
        writeLength(encoded.length)
        apb.append(encoded)
    }

    writeByte(0) //end of file

    if(saveData){
        await downloadFile(module.name + '.risum', apb.buffer)
    }
    if(alertEnd){
        alertNormal(language.successExport)
    }

    return apb.buffer
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
async function* readRisumRecordPieces(source: ImportSource, record: RisumRecord): AsyncGenerator<Uint8Array, void, undefined> {
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
        //decodeRPack returns a new array and leaves `bytes` alone, which may be a view of memory the source does not give away.
        yield await decodeRPack(bytes)
    }
}

/** A hook for the caller to stop the read once the scanned module is known (the low-level-access and duplicate questions). */
export type ReadModuleOptions = {beforeAssets?: (module:RisuModule) => Promise<void>}

/**
 * Reads a `.risum` module and saves its assets. The source is read in two passes and never as a whole: the first
 * validates the structure (see scanRisum), the second reads one record at a time, in file order, and saves it. A record
 * below ASSET_PIECE_SAVE_MIN_BYTES is read whole; decoded records waiting to be saved are bounded by count and, beyond
 * the first one, by charxLimits.backlogBytes. A record at or above it is read, decoded and saved in pieces while the
 * next record waits and is not counted against the backlog: in the desktop and Android app it holds a few pieces, on the
 * browser's IndexedDB store saveAssetFromPieces accumulates the pieces in a Blob (the page holds no whole copy), and on
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
 */
export async function readModule(input:Uint8Array|ImportSource, opts?:ReadModuleOptions):Promise<RisuModule> {
    const source = isImportSource(input) ? input : importSourceOfBytes('module.risum', input)
    let progressShown = false
    let scan: RisumScan
    try {
        if(source.size > SHOW_READING_ABOVE_BYTES){
            progressShown = true
            alertWait(language.alerts.readingCard)
        }
        scan = await scanRisum(source)
    } catch (error) {
        if(progressShown){
            alertClear()
        }
        throw error
    }
    const module = scan.module
    const totalAssets = scan.records.length
    let completed = 0

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
        let blobRefusal: Error | null = null

        for(const index of indices){
            const record = scan.records[index]
            if(record.length >= ASSET_PIECE_SAVE_MIN_BYTES){
                //Saved here, not in the background: its pieces are read from the source one after another, and no other record is read meanwhile.
                try {
                    if (!module.assets?.[index]) {
                        throw new Error(`Missing asset metadata for index ${index}`)
                    }
                    module.assets[index][1] = await saveAssetFromPieces(readRisumRecordPieces(source, record), {
                        sizeBound: record.length,
                        beforeFinish: assertSourceUnchanged,
                    })
                    completed += 1
                } catch (error) {
                    if(error instanceof AssetSourceChangedError){
                        readFailure = { cause: error }
                        break
                    }
                    //A browser that keeps no Blob refuses this asset every time; a retry cannot help and the localized refusal must reach the user.
                    //Rethrown after the saves already in flight settle, so none of them reports over the caller's error.
                    if(error instanceof Error && error.cause instanceof StoreBlobUnsupportedError){
                        blobRefusal = error
                        break
                    }
                    failed.push(index)
                } finally {
                    alertWait(fillLang(language.alerts.addingAssets, { completed, total: totalAssets }))
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
                } catch (error) {
                    failed.push(index)
                } finally {
                    inFlightBytes -= record.length
                    alertWait(fillLang(language.alerts.addingAssets, { completed, total: totalAssets }))
                }
            })()
            inFlight.add(promise)
            promise.finally(() => inFlight.delete(promise))
        }

        await Promise.all(inFlight)
        if(blobRefusal !== null){
            throw blobRefusal
        }
        if(readFailure){
            throw changed(readFailure.cause)
        }
        return failed.sort((a, b) => a - b)
    }

    try {
        await opts?.beforeAssets?.(module)
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
        alertClear()
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
function commitModule(module:RisuModule, decision:DuplicateDecision, session:DuplicateSession):string[] {
    markBootWrite()
    const placement = applyModulePlacement(DBState.db.modules, module, decision)
    if(placement.kind === 'added'){
        return []
    }
    refreshModules()
    session.replaced = true
    return describeReplace(placement.previous, module)
}

/** Decides the duplicate question of a module that was read in full, then writes it. A skip writes nothing. */
async function placeModule(module:RisuModule, file:File, session:DuplicateSession, laterFiles:boolean):Promise<ImportOutcome> {
    const decision = await session.decide(DBState.db.modules, module.name, file.name, laterFiles)
    if(decision.choice === 'skip'){
        return {kind: 'skipped'}
    }
    return importedOutcome(commitModule(module, decision, session))
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
async function importModuleFile(file:File, batch:boolean, session:DuplicateSession, laterFiles:boolean):Promise<ImportOutcome> {
    const route = moduleFileRoute(file.name)
    if(!route){
        return {kind: 'refused', reason: batch ? language.importUnsupportedFile : language.moduleUnsupportedFile(file.name), normal: true}
    }
    const batchFile = batch ? file.name : undefined
    try {
        if(route.kind === 'charx'){
            //The archive is handed over as the picked File, which is read in pieces, never as one buffer. The importer tests the suffix in lower case.
            const outcome = await importCharacterFile({
                name: file.name.slice(0, -route.suffix.length) + route.suffix,
                data: file,
                returnCharacter: true,
                lowLevelLabel: (cardName) => language.moduleLowLevelNamed(cardName, batchFile)
            })
            if(outcome.kind !== 'imported'){
                return outcome
            }
            if(!outcome.character){
                return {kind: 'refused', reason: language.errors.noData}
            }
            return await placeModule(convertCharacterToModule(outcome.character), file, session, laterFiles)
        }
        if(route.kind === 'risum'){
            const source = importSourceOfFile(file)
            try {
                //The duplicate answer is taken before any asset is saved; a skip saves nothing. Only the write happens after the read.
                let decision:DuplicateDecision = {choice: 'add'}
                const module = await readModule(source, {beforeAssets: async (scanned) => {
                    await confirmRisumLowLevel(scanned, batchFile)
                    decision = await session.decide(DBState.db.modules, scanned.name, file.name, laterFiles)
                    if(decision.choice === 'skip'){
                        throw new ModuleImportStopped('skipped')
                    }
                }})
                return importedOutcome(commitModule(module, decision, session))
            } finally {
                await source.close()
            }
        }
        return await importModuleJson(file, batchFile, session, laterFiles)
    } catch (error) {
        if(!(error instanceof ModuleImportStopped)){
            console.error(error)
        }
        return outcomeOfError(error)
    }
}

//A `.json` or `.lorebook` file: a module, a risu lorebook, an external lorebook or a regex list. What none of these fits is refused at the normal alert level, like a file that does not parse.
async function importModuleJson(file:File, batchFile:string|undefined, session:DuplicateSession, laterFiles:boolean):Promise<ImportOutcome> {
    const fileData = new Uint8Array(await file.arrayBuffer())
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

            if(importData.lowLevelAccess){
                const prompt = batchFile ? `${language.moduleLowLevelNamed(importData.name, batchFile)}\n${language.lowLevelAccessConfirm}` : language.lowLevelAccessConfirm
                const conf = await alertConfirm(prompt)
                if(!conf){
                    return {kind: 'declined'}
                }
            }
            return await placeModule(importData, file, session, laterFiles)
        }
        // importData.type === 'risu' in conflict with HypaV3 preset exports
        // difference: record vs. array
        if(importData.type === 'risu' && importData.data && Array.isArray(importData.data)){
            const lores:loreBook[] = importData.data
            return await placeModule({
                name: importData.name || 'Imported Lorebook',
                description: importData.description || 'Converted from risu lorebook',
                lorebook: lores,
                id: v4()
            }, file, session, laterFiles)
        }
        if(importData.entries){
            const lores:loreBook[] = convertExternalLorebook(importData.entries)
            return await placeModule({
                name: importData.name || 'Imported Lorebook',
                description: importData.description || 'Converted from external lorebook',
                lorebook: lores,
                id: v4()
            }, file, session, laterFiles)
        }
        if(importData.type === 'regex'  && importData.data){
            const regexs:customscript[] = importData.data
            return await placeModule({
                name: importData.name || 'Imported Regex',
                description: importData.description || 'Converted from risu regex',
                regex: regexs,
                id: v4()
            }, file, session, laterFiles)
        }
    } catch (error) {
        console.error(error)
    }
    return {kind: 'refused', reason: language.errors.noData, normal: true}
}

/**
 * What one picked file leaves on screen, by the outcome of its import: a `.charx` that imported reports success, a
 * `.risum` or json module that imported shows nothing; a decline or a skip shows nothing; a refusal is an error, or a
 * normal alert when the outcome says so; a failure shows its details.
 */
export function singleFileFeedback(outcome:ImportOutcome, fileName:string){
    if(outcome.kind === 'imported'){
        //A replace that changed the namespace adds its note to the one message of the import, never a second alert.
        const notes = outcome.notes ?? []
        if(moduleFileRoute(fileName)?.kind === 'charx'){
            alertNormal([language.successImport, ...notes].join('\n'))
        }
        else if(notes.length > 0){
            alertNormal(notes.join('\n'))
        }
        return
    }
    if(outcome.kind === 'refused' && outcome.normal){
        alertNormal(outcome.reason)
        return
    }
    showOutcome(outcome)
}

/**
 * Imports the files picked in Settings > Modules, in order, one at a time. One file reports as `singleFileFeedback`
 * says. Several files are all attempted inside one busy scope and end with one message: the files that were not
 * imported with their reasons, or a count when nothing went wrong. A module that is imported stays imported when a
 * later file fails.
 */
export async function importModule(){
    const files = await selectFileByDom(['*'], 'multiple')
    if(!files || files.length === 0){
        return
    }
    const session = new DuplicateSession()
    if(files.length === 1){
        const file = files[0]
        const outcome = await withBusy('import', () => importModuleFile(file, false, session, false))
        if(session.replaced){
            bumpModuleGui()
        }
        singleFileFeedback(outcome, file.name)
        return
    }
    const summary = await runImportBatch(
        files.map((file, index) => ({name: file.name, run: () => importModuleFile(file, true, session, index < files.length - 1)})),
        {declinedReason: language.importDeclinedLowLevel}
    )
    if(session.replaced){
        bumpModuleGui()
    }
    if(!summary.message && !summary.own){
        alertNormal([language.importModulesDone(summary.imported, summary.skipped), ...summary.notes].join('\n'))
    }
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
export function getModuleLorebooks(subject?: RunSubject) {
    const modules = getModules(subject)
    let lorebooks: loreBook[] = []
    for (const module of modules) {
        if(!module || isModuleStub(module)){
            continue
        }
        if (module.lorebook) {
            lorebooks = lorebooks.concat(module.lorebook)
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

export function getModuleMcps(subject?: RunSubject) {
    const modules = getModules(subject)

    return modules.filter((v) => !isModuleStub(v)).map((v) => v.mcp?.url).filter((v) => v)
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

export function moduleUpdate(){


    const m = getModules()

    const ids = m.map((m) => m.id).join('-')
    
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

    if(backgroundEmbedding){
        moduleBackgroundEmbedding.set(backgroundEmbedding)
    }
    HideIconStore.set(getCurrentCharacter()?.hideChatIcon || moduleHideIcon)

    if(lastModuleIds !== ids){
        ReloadGUIPointer.set(get(ReloadGUIPointer) + 1)
        lastModuleIds = ids
    }
}

// The reactive dependency list for the above lives in ./moduleUpdateDeps.ts.
// If moduleUpdate() starts reading another module field, update it there too.

export function refreshModules(){
    lastModules = ''
    lastModuleList = undefined
    lastModuleData = []
}
