import { language } from "src/lang"
import { fillLang } from "src/lang/fill"
import { alertClear, alertConfirm, alertError, alertModuleSelect, alertNormal, alertStore, alertWait } from "../alert"
import { getCurrentCharacter, getCurrentChat, getDatabase, setCurrentCharacter, setDatabase, type customscript, type loreBook, type triggerscript } from "../storage/database.svelte"
import type { RunSubject } from "./chatOrigin"
import { ASSET_PIECE_SAVE_MIN_BYTES } from "../assetHash"
import { AppendableBuffer, AssetSourceChangedError, downloadFile, forageStorage, LocalWriter, readImage, saveAsset, saveAssetFromPieces, VirtualWriter } from "../globalApi.svelte"
import { checkPersonaBinded, selectSingleFileObject, sleep } from "../util"
import { v4 } from "uuid"
import { convertExternalLorebook } from "./lorebook.svelte"
import { compressImage } from '../media'
import { decodeRPack, encodeRPack } from "../rpack/rpack_js"
import { DBState, HideIconStore, moduleBackgroundEmbedding, ReloadGUIPointer } from "../stores.svelte"
import {get} from "svelte/store"
import { convertCharacterToModule, convertModuleToCharacter } from "../interchangeability"
import { exportCharacterCard, importCharacterProcess } from "../characterCards"
import { ModuleRefusal, importErrorMessage } from "./moduleRefusal"
import { withBusy } from "./memory/busyActions"
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
    if(!char.image){
        const res = await fetch('/none.webp')
        const data = new Uint8Array(await res.arrayBuffer())
        char.image = await saveAsset(data)
        char.extentions ??= {}
        char.extentions['moduleNoneImage'] = true
    }
    const writer = new LocalWriter()
    await writer.init(module.name + '.module', ['charx'])
    await exportCharacterCard(char, 'charx', {
        spec: 'v3',
        writer
    })
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

    const assets = module.assets ?? []
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

    for(let i=0;i<assets.length;i++){
        const asset = assets[i]
        writeByte(1) //mark as asset
        alertStore.set({
            type: 'wait',
            msg: fillLang(language.alerts.addingAssets, { completed: i, total: assets.length })
        })
        let rData = await readImage(asset[1])
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

/**
 * Reads a `.risum` module and saves its assets. The source is read in two passes and never as a whole: the first
 * validates the structure (see scanRisum), the second reads one record at a time, in file order, and saves it. A record
 * below ASSET_PIECE_SAVE_MIN_BYTES is read whole; decoded records waiting to be saved are bounded by count and, beyond
 * the first one, by charxLimits.backlogBytes. A record at or above it is read, decoded and saved in pieces while the
 * next record waits and is not counted against the backlog: in the desktop and Android app it holds a few pieces, and
 * elsewhere saveAssetFromPieces collects it whole.
 *
 * The magic byte, version, module type and block mark checks, a file cut short, a record count that does not match the
 * module's asset list, and an asset over the limit throw a ModuleRefusal before any asset is saved. A source that
 * changes between the passes or cannot be read throws a ModuleRefusal too, and is not retried. Any other error (corrupt
 * JSON, "Failed to save n assets" after the save retries) passes through as it is; a record whose save failed is read
 * from the source again for each retry.
 * It shows progress and clears it before it returns or throws, and never shows an error itself: the caller shows it.
 * It never returns without a module. It does not close the source: the caller that opened it does.
 */
export async function readModule(input:Uint8Array|ImportSource):Promise<RisuModule> {
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
        if(readFailure){
            throw changed(readFailure.cause)
        }
        return failed.sort((a, b) => a - b)
    }

    try {
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

export async function importModule(){
    const f = await selectSingleFileObject(['json', 'lorebook', 'risum', 'charx'])
    if(!f){
        return
    }
    if(f.name.endsWith('.charx')){
        try {
            //The archive is handed over as the picked file, which is read in pieces, never as one buffer.
            const char = await withBusy('import', () => importCharacterProcess({
                name: f.name,
                data: f,
                returnCharacter: true
            }))
            //A refusal has shown its own message and a declined low-level-access prompt shows none (it returns false, a type the declared return leaves out); neither is followed by another message.
            if(!char || typeof char === 'number'){
                return
            }
            const module = convertCharacterToModule(char)
            DBState.db.modules.push(module)
        } catch (error) {
            console.error(error)
            alertError(importErrorMessage(error))
            return
        }
        alertNormal(language.successImport)
        return
    }
    if(f.name.endsWith('.risum')){
        const source = importSourceOfFile(f)
        try {
            const module = await withBusy('import', () => readModule(source))
            DBState.db.modules.push(module)
        } catch (error) {
            console.error(error)
            alertError(importErrorMessage(error))
        } finally {
            await source.close()
        }
        return
    }
    const fileData = new Uint8Array(await f.arrayBuffer())
    try {
        const importData = JSON.parse(Buffer.from(fileData).toString())
        if(importData.type === 'risuModule'){
            if(
                (!importData.name)
                || (!importData.id)
            ){
                alertError(language.errors.noData)
                return
            }
            importData.id = v4()

            if(importData.lowLevelAccess){
                const conf = await alertConfirm(language.lowLevelAccessConfirm)
                if(!conf){
                    return false
                }
            }
            DBState.db.modules.push(importData)
            return
        }
        // importData.type === 'risu' in conflict with HypaV3 preset exports
        // difference: record vs. array
        if(importData.type === 'risu' && importData.data && Array.isArray(importData.data)){
            const lores:loreBook[] = importData.data
            const importModule = {
                name: importData.name || 'Imported Lorebook',
                description: importData.description || 'Converted from risu lorebook',
                lorebook: lores,
                id: v4()
            }
            DBState.db.modules.push(importModule)
            return
        }
        if(importData.entries){
            const lores:loreBook[] = convertExternalLorebook(importData.entries)
            const importModule = {
                name: importData.name || 'Imported Lorebook',
                description: importData.description || 'Converted from external lorebook',
                lorebook: lores,
                id: v4()
            }
            DBState.db.modules.push(importModule)
            return
        }
        if(importData.type === 'regex'  && importData.data){
            const regexs:customscript[] = importData.data
            const importModule = {
                name: importData.name || 'Imported Regex',
                description: importData.description || 'Converted from risu regex',
                regex: regexs,
                id: v4()
            }
            DBState.db.modules.push(importModule)
            return
        }
    } catch (error) {
        console.error(error)
    }

    alertNormal(language.errors.noData)
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

function getModuleByIds(ids:string[]){
    const db = getDatabase()
    const idSet = new Set(ids)
    const modules = db.modules.filter(m => 
        idSet.has(m.id) || (m.namespace && idSet.has(m.namespace))
    )
    return deduplicateModuleById(modules)
}

function deduplicateModuleById(modules:RisuModule[]){
    let ids:string[] = []
    let newModules:RisuModule[] = []
    for(let i=0;i<modules.length;i++){
        if(ids.includes(modules[i].id)){
            continue
        }
        ids.push(modules[i].id)
        newModules.push(modules[i])
    }
    return newModules
}

let lastModules = ''
let lastModuleData:RisuModule[] = []
export function getModules(subject?: RunSubject){
    let currentChat: ReturnType<typeof getCurrentChat>
    let character: ReturnType<typeof getCurrentCharacter>
    let persona: ReturnType<typeof checkPersonaBinded>
    if(subject){
        const ctx = subject.resolve()
        currentChat = ctx?.chat
        character = ctx?.owner
        persona = checkPersonaBinded(ctx?.chat ?? null)
    } else {
        currentChat = getCurrentChat()
        character = getCurrentCharacter()
        persona = checkPersonaBinded()
    }
    const db = getDatabase()
    let ids = db.enabledModules ?? []
    if (currentChat){
        ids = ids.concat(currentChat.modules ?? [])
    }
    if(character && character.modules){
        ids = ids.concat(character.modules)
    }
    if(persona && persona.embeddedModule){
        ids = ids.concat([persona.embeddedModule?.id])
    }
    if(db.moduleIntergration){
        const intList = db.moduleIntergration.split(',').map((s) => s.trim())
        ids = ids.concat(intList)
    }
    const idsJoined = ids.join('-')
    if(lastModules === idsJoined){
        return lastModuleData
    }

    let modules:RisuModule[] = getModuleByIds(ids)
    lastModules = idsJoined
    lastModuleData = modules
    return modules

}


export function getModuleLorebooks(subject?: RunSubject) {
    const modules = getModules(subject)
    let lorebooks: loreBook[] = []
    for (const module of modules) {
        if(!module){
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
        if(!module){
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
        if(!module){
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
        if(!module){
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
        if(!module){
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

    return modules.map((v) => v.mcp?.url).filter((v) => v)
}

export async function applyModule() {
    const sel = await alertModuleSelect()
    if (!sel) {
        return
    }

    const module = safeStructuredClone(getModuleById(sel))
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
    lastModuleData = []
}
