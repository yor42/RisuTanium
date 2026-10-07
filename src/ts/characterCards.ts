import { writable, get, type Writable } from "svelte/store"
import { alertCardExport, alertConfirm, alertError, alertInput, alertNormal, alertStore, alertWait } from "./alert"
import { askUpstreamAgreement, isUpstreamAccepted, publishUpstreamAccepted } from "./upstreamAgreement"
import { defaultSdDataFunc, type character, setDatabase, type customscript, type loreSettings, type loreBook, type triggerscript, importPreset, type groupChat, getDatabase, setDatabaseLite, appVer } from "./storage/database.svelte"
import { checkNullish, decryptBuffer, isKnownUri, selectFileByDom, sleep } from "./util"
import { language } from "src/lang"
import { fillLang } from "src/lang/fill"
import { v4 as uuidv4, v4 } from 'uuid';
import { changeChar, characterFormatUpdate } from "./characters"
import { ASSET_PIECE_SAVE_MIN_BYTES } from "./assetHash"
import { AppendableBuffer, AssetSourceChangedError, BlankWriter, checkCharOrder, downloadFile, loadAsset, LocalWriter, readImage, saveAsset, saveAssetFromPieces, VirtualWriter } from "./globalApi.svelte"
import { isTauri, isNodeServer } from "src/ts/platform"
import { compressImage, getImageType } from "./media"
import { DBState, SettingsMenuIndex, ShowRealmFrameStore, selectedCharID, settingsOpen } from "./stores.svelte"
import { hasher } from "./parser/parser.svelte"
import { type CharacterCardV3, type LorebookEntry } from '@risuai/ccardlib'
import { reencodeImage } from "./process/files/inlays"
import { PngChunk, type PngLayoutChunk } from "./pngChunk"
import { ASSET_KEY_PREFIX, PngCardSourceChanged, PngCardValueTooLarge, assetIndexOfKey, isEmptyCardValue, readCardValue, selectCardChunk, walkPngCard } from "./pngCardImport"
import { decodeBase64Bytes } from "./base64Bytes"
import type { OnnxModelFiles } from "./process/transformers"
import { CharXImporter, CharXParseError, CharXWriter, assetByteLimit, hasZipEndRecord } from "./process/processzip"
import { exportModuleLegacy, readModule, type RisuModule } from "./process/modules"
import { ModuleRefusal } from "./process/moduleRefusal"
import { importSourceOfBytes, importSourceOfFile, isImportSource, openDesktopImportSource, type ImportSource } from "./importSource"
import { beginBusy, withBusy } from "./process/memory/busyActions"
import { markBootWrite } from "./bootWindow"
import { wasBootedByIdleReload } from "./process/memory/idleReloadBootState"
import { filterBlockedRealmCards, isRealmCreatorBlocked } from "./realmBlocking"


const EXTERNAL_HUB_URL = 'https://sv.risuai.xyz';
const NIGHTLY_HUB_URL = 'https://nightly.sv.risuai.xyz'
export const hubURL = isNodeServer
    ? '/hub-proxy'
    : (import.meta.env.VITE_RISU_NIGHTLY_BUILD === 'TRUE' || localStorage.getItem('hub') === 'nightly')
    ? NIGHTLY_HUB_URL 
    : EXTERNAL_HUB_URL;

/**
 * How the attempt to import one file ended. The import code decides it; nothing reads alert text.
 * - imported: a character, preset or module was added (`index` is the new character's position, `null` for a preset, a
 *   module, or a character handed back instead of added).
 * - declined: the user chose not to go on (the low-level-access prompt or the card password prompt). Nothing is shown.
 * - refused: the file is not usable; `reason` is shown as text. `summaryOnly` marks a reason that has no message of its own.
 * - failed: an unexpected error; it is shown with its details.
 */
type ImportOutcome =
    | {kind: 'imported', index: number|null, character?: character}
    | {kind: 'declined'}
    | {kind: 'refused', reason: string, summaryOnly?: true}
    | {kind: 'failed', error: Error|string}

type ImportItem = {name: string, run: () => Promise<ImportOutcome>}

const refusedOutcome = (reason:string):ImportOutcome => ({kind: 'refused', reason})

//A refused module is a refusal whichever import it came out of; any other error is a failure.
function outcomeOfError(error:unknown):ImportOutcome {
    if(error instanceof ModuleRefusal){
        return refusedOutcome(error.message)
    }
    return {kind: 'failed', error: error instanceof Error ? error : String(error)}
}

function outcomeReason(outcome:ImportOutcome):string {
    if(outcome.kind === 'refused'){
        return outcome.reason
    }
    if(outcome.kind === 'failed'){
        return outcome.error instanceof Error ? outcome.error.message : outcome.error
    }
    return ''
}

//One file's own message: a refusal as text, a failure with its details.
function showOutcome(outcome:ImportOutcome) {
    if(outcome.kind === 'refused'){
        alertError(outcome.reason)
    }
    else if(outcome.kind === 'failed'){
        alertError(outcome.error)
    }
}

/**
 * Attempts every item, whatever an earlier item's outcome, then shows what did not import. The loop never rejects.
 * When something was refused or failed, the last message of the action is one error: the file's own message when the
 * action had a single file with a message of its own, otherwise a summary naming each file and its reason. Nothing is
 * shown after it. When nothing was refused or failed, the alerts of the last file stay as they are.
 */
function importFiles(items:ImportItem[]):Promise<void> {
    return withBusy('import', () => importEachFile(items))
}

async function importEachFile(items:ImportItem[]):Promise<void> {
    const results:ImportOutcome[] = []
    for(const item of items){
        let outcome:ImportOutcome
        try {
            outcome = await item.run()
        } catch (error) {
            console.error(error)
            outcome = outcomeOfError(error)
        }
        if(outcome.kind === 'imported' && outcome.index !== null){
            try {
                checkCharOrder()
            } catch (error) {
                console.error(error)
            }
        }
        results.push(outcome)
    }
    const notImported = items
        .map((item, i) => ({item, outcome: results[i]}))
        .filter(({outcome}) => outcome.kind === 'refused' || outcome.kind === 'failed')
    if(notImported.length === 0){
        return
    }
    const only = notImported[0].outcome
    if(items.length === 1 && !(only.kind === 'refused' && only.summaryOnly)){
        showOutcome(only)
        return
    }
    alertError(language.importFilesNotImported(
        notImported.length,
        items.length,
        notImported.map(({item, outcome}) => `${item.name}: ${outcomeReason(outcome)}`).join('\n')
    ))
}

//One entry of a multi-file import whose kind is decided by its name: a name that is not a card, preset or module, or a read that yields no data, is refused with a reason of its own; a read that throws is a failure.
//A source the read hands over is closed on every exit of the item, whichever way the import ends.
function classifiedImport(label:string, name:string, type:string, read:(kind:ClassifiedImport) => Promise<File|ImportSource|null>):ImportItem {
    return {
        name: label,
        run: async () => {
            const kind = classifyImportFile(name, type)
            if(!kind){
                return {kind: 'refused', reason: language.importUnsupportedFile, summaryOnly: true}
            }
            const data = await read(kind)
            if(!data){
                return {kind: 'refused', reason: language.importFileNotReceived, summaryOnly: true}
            }
            try {
                return await importClassified(kind, data)
            } finally {
                if(isImportSource(data)){
                    await data.close()
                }
            }
        }
    }
}

//Files the operating system handed to the desktop app, read through the plugin-fs scope that was widened for exactly these paths. Each file is opened as a source that is read in pieces and closed when its import ends. Never rejects.
export async function importOpenedFiles(paths:string[]):Promise<void> {
    try {
        await importFiles(paths.map((path) => classifiedImport(path.split(/[\\/]/).pop() || path, path, '', () => openDesktopImportSource(path))))
    } catch (error) {
        alertError(error)
    }
}

//Cards and modules are handed on as the File or the source as it is, for the importer to read in pieces; a preset is read whole. The caller owns a source and closes it.
async function importClassified(file:ClassifiedImport, data:File|ImportSource):Promise<ImportOutcome> {
    try {
        if(file.kind === 'card'){
            return await importCharacterFile({
                name: file.name,
                data: data
            })
        }
        if(file.kind === 'preset'){
            const bytes = data instanceof File ? new Uint8Array(await data.arrayBuffer()) : await data.read(0, data.size)
            //Every import write in this file that adds a character, module or preset announces itself first: one that lands before the change effects exist is unsaved work the effects cannot see.
            markBootWrite()
            await importPreset({
                name: file.name,
                data: bytes
            })
            SettingsMenuIndex.set(1)
            settingsOpen.set(true)
            alertNormal(language.successImport)
            return {kind: 'imported', index: null}
        }
        const md = await readModule(data instanceof File ? importSourceOfFile(data) : data)
        md.id = v4()
        markBootWrite()
        DBState.db.modules.push(md)
        alertNormal(language.successImport)
        SettingsMenuIndex.set(14)
        settingsOpen.set(true)
        return {kind: 'imported', index: null}
    } catch (error) {
        console.error(error)
        return outcomeOfError(error)
    }
}

export async function importCharacter() {
    try {
        const files = await selectFileByDom(["*"], 'multiple')
        if(!files){
            return
        }

        await importFiles(Array.from(files, (f) => ({
            name: f.name,
            run: () => importCharacterFile({
                name: f.name,
                data: f
            })
        })))
    } catch (error) {
        alertError(error)
        return null
    }
}

type ImportProcessResult<T extends boolean> = T extends true ? character | number | null : number | null

/**
 * Imports one character file and shows its own message when it is refused or fails. It never rejects: the result is
 * the new character's index (or the character itself with `returnCharacter`) when something was imported, and
 * `undefined` when the file was declined, refused or failed.
 */
export async function importCharacterProcess<T extends boolean = false>(f:{
    name: string;
    data: Uint8Array|File|ImportSource|ReadableStream<Uint8Array>
    returnCharacter?:T //note That this option only works with v3 charx
}):Promise<ImportProcessResult<T>>{
    const outcome = await importCharacterFile(f)
    if(outcome.kind === 'imported'){
        return (outcome.character ?? outcome.index) as ImportProcessResult<T>
    }
    showOutcome(outcome)
    return undefined
}

//Reads one character file and reports how it ended. It never rejects.
async function importCharacterFile(f:{
    name: string;
    data: Uint8Array|File|ImportSource|ReadableStream<Uint8Array>
    returnCharacter?:boolean
}):Promise<ImportOutcome>{
    try {
        return await readCharacterFile(f)
    } catch (error) {
        console.error(error)
        return outcomeOfError(error)
    }
}

async function readCharacterFile(f:{
    name: string;
    data: Uint8Array|File|ImportSource|ReadableStream<Uint8Array>
    returnCharacter?:boolean
}):Promise<ImportOutcome>{
    if(f.name.endsWith('json')){
        if(!f.data || f.data instanceof ReadableStream){
            return refusedOutcome(language.errors.noData)
        }
        const data = f.data instanceof Uint8Array ? f.data : isImportSource(f.data) ? await f.data.read(0, f.data.size) : new Uint8Array(await f.data.arrayBuffer())
        const da = JSON.parse(Buffer.from(data).toString('utf-8'))
        const spec = await importCharacterCardSpec(da)
        if(spec){
            let db = getDatabase()
            return {kind: 'imported', index: db.characters.length - 1}
        }
        if(spec === false){
            return {kind: 'declined'}
        }
        if((da?.char_name || da?.name) && (da.char_persona || da.description) && (da.char_greeting || da.first_mes)){
            markBootWrite()
            DBState.db.characters.push(convertOffSpecCards(da))
            alertNormal(language.importedCharacter)
            return {kind: 'imported', index: DBState.db.characters.length - 1}
        }
        return refusedOutcome(language.errors.noData)
    }
    let db = getDatabase()
    db.statics.imports += 1

    if(f.name.endsWith('charx') || f.name.endsWith('jpg') || f.name.endsWith('jpeg')){
        console.log('reading charx')
        alertStore.set({
            type: 'wait',
            msg: language.alerts.readingCard
        })

        const importer = new CharXImporter()
        importer.alertInfo = true
        //A zip failure means the archive is unreadable; an entry over its size limit refuses the card with a message naming the file; a failure of the read or of the importer itself shows its own message.
        //The importer shows no progress after its first failure, so nothing replaces the message.
        try {
            //The end-of-archive check needs the tail of the whole input, so a stream is buffered into a Blob-backed File first.
            const charxData:File|Uint8Array|ImportSource = f.data instanceof ReadableStream
                ? new File([await new Response(f.data).blob()], f.name, {type: 'application/zip'})
                : f.data
            //An archive without its end record was cut short. A jpg or jpeg without one is treated as a plain image (a jpg-charx cut short cannot be told apart by its tail).
            if(!(await hasZipEndRecord(charxData))){
                return refusedOutcome(f.name.endsWith('charx') ? language.cardFileIncomplete : language.errors.noData)
            }
            await importer.parse(charxData)
        } catch (error) {
            if(error instanceof CharXParseError && error.origin === 'size'){
                return refusedOutcome(language.cardFileEntryTooLarge(error.entryName ?? '', Math.round((error.limitBytes ?? 0) / (1024 * 1024))))
            }
            if(error instanceof CharXParseError && error.origin === 'zip'){
                return refusedOutcome(language.cardFileIncomplete)
            }
            return outcomeOfError(error)
        }
        //Whichever way this ends, the importer is finished with: asset saves that have not started do not start, and no progress message replaces what the import shows next.
        try {
            const cardData = importer.cardData
            if(!cardData){
                return refusedOutcome(language.errors.noData)
            }
            const card:CharacterCardV3 = JSON.parse(cardData)
            if(card.spec !== 'chara_card_v3'){
                return refusedOutcome(language.errors.noData)
            }
            let lorebook:loreBook[] = null
            if(importer.moduleData){
                let md:RisuModule
                try {
                    md = await readModule(Buffer.from(importer.moduleData))
                } catch (error) {
                    //An embedded module that is not usable refuses the whole card
                    if(error instanceof ModuleRefusal){
                        return refusedOutcome(error.message)
                    }
                    throw error
                }
                card.data.extensions ??= {}
                card.data.extensions.risuai ??= {}
                card.data.extensions.risuai.triggerscript = md.trigger ?? []
                card.data.extensions.risuai.customScripts = md.regex ?? []
                if(md.lorebook){
                    lorebook = md.lorebook
                }
            }
            await importer.done()
            const v = await importCharacterCardSpec(card, undefined, 'normal', importer.assets, lorebook, f.returnCharacter)
            if(v === null){
                return refusedOutcome(language.errors.noData)
            }
            if(v === false){
                return {kind: 'declined'}
            }
            if(v === true){
                return {kind: 'imported', index: getDatabase().characters.length - 1}
            }
            return {kind: 'imported', index: null, character: v}
        } finally {
            importer.abandon()
        }
    }

    if(!f.name.endsWith('png')){
        return refusedOutcome(language.importNotCardFile)
    }
    

    alertStore.set({
        type: 'wait',
        msg: language.alerts.readingCard
    })
    await sleep(10)

    //A stream is buffered into a Blob-backed File first, so the card is read by offset like any other file.
    const pngData:File|Uint8Array|ImportSource = f.data instanceof ReadableStream
        ? new File([await new Response(f.data).blob()], f.name, {type: 'image/png'})
        : f.data
    return await importPngCard(f.name, pngData)
}

//The outcome of `importCharacterCardSpec` for a card that was added: `false` is a declined prompt, `null` a card of no known spec.
function cardSpecOutcome(result:boolean|null, index:number, notACard:string = language.errors.noData):ImportOutcome {
    if(result === null){
        return refusedOutcome(notACard)
    }
    return result ? {kind: 'imported', index} : {kind: 'declined'}
}

/**
 * Where a PNG card stands after its first pass: a refusal or a declined prompt (an `ImportOutcome`), or the card to
 * import. `spec` is a v2 or v3 card; `tavern` is a card of an older format that carries no assets.
 */
type PngCardPlan =
    | ImportOutcome
    | {kind: 'spec', card: CharacterCardV2Risu|CharacterCardV3}
    | {kind: 'tavern', card: OldTavernChar}

//A string longer than the engine builds throws a RangeError; it is the same refusal as a card value known to be too long up front.
function guardStringLength<T>(build:() => T):T {
    try {
        return build()
    } catch (error) {
        if(error instanceof RangeError){
            throw new PngCardValueTooLarge(error.message)
        }
        throw error
    }
}

/** The message of the first asset or image over the limit, or null. An asset chunk's decoded size is at most three quarters of its base64 text. */
function pngCardOverLimit(chunks:PngLayoutChunk[], imageBytes:number):string|null {
    const limit = assetByteLimit()
    const limitMiB = Math.round(limit / (1024 * 1024))
    for(const chunk of chunks){
        if(chunk.key !== null && chunk.key.startsWith(ASSET_KEY_PREFIX) && Math.floor((chunk.length - chunk.valueStart) * 3 / 4) > limit){
            return language.cardFileEntryTooLarge(chunk.key, limitMiB)
        }
    }
    return imageBytes > limit ? language.cardImageTooLarge(limitMiB) : null
}

/**
 * The first reference of a v2 or v3 card that the import resolves through the asset chunks and that has no chunk, as the
 * import itself reads them: in a v2 card the `__asset:` values of the emotions, additional assets and vits, in a v3 card
 * the `__asset:` and `embeded://` uris of its assets. Null when every one resolves.
 */
function firstMissingAssetKey(card:CharacterCardV2Risu|CharacterCardV3, assetKeys:Set<string>):string|null {
    const risuext = card.data.extensions.risuai
    if(risuext && card.spec === 'chara_card_v2'){
        if(risuext.emotions){
            for(let i=0;i<risuext.emotions.length;i++){
                if(risuext.emotions[i][1].startsWith('__asset:')){
                    const key = risuext.emotions[i][1].replace('__asset:', '')
                    if(!assetKeys.has(key)){
                        return key
                    }
                }
            }
        }
        if(risuext.additionalAssets){
            for(let i=0;i<risuext.additionalAssets.length;i++){
                if(risuext.additionalAssets[i][1].startsWith('__asset:')){
                    const key = risuext.additionalAssets[i][1].replace('__asset:', '')
                    if(!assetKeys.has(key)){
                        return key
                    }
                }
            }
        }
        if(risuext.vits){
            for(const name of Object.keys(risuext.vits)){
                if(risuext.vits[name].startsWith('__asset:')){
                    const key = risuext.vits[name].replace('__asset:', '')
                    if(!assetKeys.has(key)){
                        return key
                    }
                }
            }
        }
    }
    if(card.spec === 'chara_card_v3'){
        const assets = card.data.assets
        if(assets){
            for(let i=0;i<assets.length;i++){
                const uri = assets[i].uri
                const key = uri.startsWith('__asset:') ? uri.replace('__asset:', '')
                    : uri === 'ccdefault:' ? null
                    : uri.startsWith('embeded://') ? uri.replace('embeded://', '')
                    : null
                if(key !== null && !assetKeys.has(key)){
                    return key
                }
            }
        }
    }
    return null
}

//A v2 or v3 card whose references all resolve and whose low-level-access prompt, when it has one, was accepted. The prompt is asked here, before any asset is saved, and not again by the import.
async function planSpecCard(card:CharacterCardV2Risu|CharacterCardV3, assetKeys:Set<string>, notACard:string):Promise<PngCardPlan> {
    if(!card || (card.spec !== 'chara_card_v2' && card.spec !== 'chara_card_v3')){
        return refusedOutcome(notACard)
    }
    const missing = firstMissingAssetKey(card, assetKeys)
    if(missing !== null){
        return refusedOutcome(fillLang(language.errors.importAssetNotFound, { key: missing }))
    }
    const risuext = card.data.extensions.risuai
    if(risuext && risuext.lowLevelAccess){
        if(!await alertConfirm(language.lowLevelAccessConfirm)){
            return {kind: 'declined'}
        }
    }
    return {kind: 'spec', card}
}

//A card of the rcc format: its hash is checked, the password asked for and the card decrypted.
async function planRccCard(value:string, assetKeys:Set<string>):Promise<PngCardPlan> {
    const parts = value.split('||')
    const type = parts[1]
    if(type !== 'rccv1'){
        return refusedOutcome(language.errors.noData)
    }
    if(parts.length !== 5){
        return refusedOutcome(language.errors.noData)
    }
    const encrypted = Buffer.from(parts[2], 'base64')
    const hashed = await hasher(encrypted)
    if(hashed !== parts[3]){
        return refusedOutcome(language.errors.noData)
    }
    let metaData:RccCardMetaData
    try {
        metaData = JSON.parse(Buffer.from(parts[4], 'base64').toString('utf-8'))
    } catch (error) {
        if(error instanceof SyntaxError){
            return refusedOutcome(language.errors.noData)
        }
        throw error
    }
    if(metaData.usePassword){
        const password = await alertInput(language.inputCardPassword)
        if(!password){
            return {kind: 'declined'}
        }
        //Only reading the card with this password can mean the password is wrong; a failure of the import itself keeps its own reason.
        let charaData:CharacterCardV2Risu
        try {
            const decrypted = await decryptBuffer(encrypted, password)
            charaData = JSON.parse(Buffer.from(decrypted).toString('utf-8'))
        } catch (error) {
            return refusedOutcome(language.errors.wrongPassword)
        }
        return await planSpecCard(charaData, assetKeys, language.errors.wrongPassword)
    }
    const decrypted = await decryptBuffer(encrypted, 'RISU_NONE')
    let charaData:CharacterCardV2Risu
    try {
        charaData = JSON.parse(Buffer.from(decrypted).toString('utf-8'))
    } catch (error) {
        return refusedOutcome(language.errors.noData)
    }
    return await planSpecCard(charaData, assetKeys, language.errors.noData)
}

//A card that is not rcc: base64 of its JSON.
async function planCardJson(json:string, assetKeys:Set<string>):Promise<PngCardPlan> {
    let parsed:CharacterCardV2Risu|CharacterCardV3
    try {
        parsed = JSON.parse(json)
    } catch (error) {
        if(error instanceof SyntaxError){
            return refusedOutcome(language.errors.noData)
        }
        throw error
    }
    //fix readedChara version pointing number instead of string because of previous version
    if(typeof (parsed as CharacterCardV2Risu)?.data?.character_version === 'number'){
        (parsed as CharacterCardV2Risu).data.character_version = (parsed as CharacterCardV2Risu).data.character_version.toString()
    }

    if(parsed.spec !== 'chara_card_v2' && parsed.spec !== 'chara_card_v3'){
        const charaData:OldTavernChar = JSON.parse(json)
        return {kind: 'tavern', card: charaData}
    }
    return await planSpecCard(parsed, assetKeys, language.errors.noData)
}

/**
 * First pass over a PNG card: everything that decides whether the card is imported, before anything is saved. The card
 * chunk is chosen (see selectCardChunk), decoded and checked (the rcc hash, password and decryption
 * included), every asset reference of the card is looked up among the asset chunks, and the low-level-access prompt is
 * asked.
 */
async function planPngCard(source:ImportSource, chunks:PngLayoutChunk[], assetKeys:Set<string>):Promise<PngCardPlan> {
    try {
        const ccv3 = await selectCardChunk(source, chunks, 'ccv3')
        const chara = await selectCardChunk(source, chunks, 'chara')
        let value:Uint8Array|null = ccv3 ? await readCardValue(source, ccv3) : null
        if(!value || isEmptyCardValue(value)){
            value = chara ? await readCardValue(source, chara) : null
        }
        if(!value || isEmptyCardValue(value)){
            return refusedOutcome(language.errors.noData)
        }
        if(new TextDecoder().decode(value.subarray(0, 8)).startsWith('rcc||')){
            const rcc = guardStringLength(() => new TextDecoder().decode(value))
            value = null
            return await planRccCard(rcc, assetKeys)
        }
        const decoded = decodeBase64Bytes(value)
        value = null
        const json = guardStringLength(() => Buffer.from(decoded.buffer, decoded.byteOffset, decoded.byteLength).toString('utf-8'))
        return await planCardJson(json, assetKeys)
    } catch (error) {
        if(error instanceof PngCardValueTooLarge || error instanceof RangeError){
            console.error(error)
            return refusedOutcome(language.errors.noData)
        }
        throw error
    }
}

/**
 * Imports a PNG card in two passes over the file, which is never held as a whole. The first pass walks the chunk
 * headers and decides, before anything is saved, whether the card is imported (see planPngCard); the second reads the
 * asset chunks one at a time, saves them and imports the card the first pass chose. A file that is not the one the
 * first pass saw, or cannot be read, is refused and saves nothing further.
 */
async function importPngCard(name:string, data:File|Uint8Array|ImportSource):Promise<ImportOutcome> {
    const source = isImportSource(data) ? data : data instanceof Uint8Array ? importSourceOfBytes(name, data) : importSourceOfFile(data)
    try {
        const stat = await source.stat()
        if(stat.size !== source.size){
            throw new PngCardSourceChanged('the card file changed')
        }
        //Counts the assets and checks that no chunk body (nor the CRC of a chunk other than tEXt) is cut short before anything is saved, so such a card saves nothing.
        const scan = await PngChunk.scanCard(data, {layout: true})
        if(scan.cut || (!scan.hasCardData && !scan.iendReached)){
            return refusedOutcome(language.cardFileIncomplete)
        }
        if(!scan.hasCardData){
            return refusedOutcome(language.errors.noData)
        }
        const chunks = scan.chunks ?? []
        const imageBytes = scan.imageBytes ?? 0
        const overLimit = pngCardOverLimit(chunks, imageBytes)
        if(overLimit !== null){
            return refusedOutcome(overLimit)
        }
        const assetKeys = new Set<string>()
        for(const chunk of chunks){
            if(chunk.key !== null && chunk.key.startsWith(ASSET_KEY_PREFIX)){
                assetKeys.add(assetIndexOfKey(chunk.key))
            }
        }
        const plan = await planPngCard(source, chunks, assetKeys)
        if(plan.kind !== 'spec' && plan.kind !== 'tavern'){
            return plan
        }

        const pngChunks = scan.assetCount
        let readedPngChunks = 0
        const assets:{[key:string]:string} = {}
        const showAssetProgress = () => {
            if(pngChunks === 0){
                alertWait(fillLang(language.alerts.loadedAssets, { count: readedPngChunks }))
            }
            else{
                alertStore.set({
                    type: 'progress',
                    msg: language.alerts.loadingAssets,
                    submsg: (readedPngChunks / pngChunks * 100).toFixed(2)
                })
            }

            readedPngChunks++
        }
        //An old card has no assets of its own to keep, so only its image is read.
        const img = await walkPngCard(source, {chunks, imageBytes, stat}, plan.kind === 'spec', async (assetIndex, assetData) => {
            showAssetProgress()
            assets[assetIndex] = await saveAsset(assetData)
        }, {
            minBytes: ASSET_PIECE_SAVE_MIN_BYTES,
            onAssetPieces: async (assetIndex, asset) => {
                showAssetProgress()
                try {
                    assets[assetIndex] = await saveAssetFromPieces(asset.pieces, {sizeBound: asset.sizeBound, beforeFinish: asset.beforeFinish})
                } catch (error) {
                    if(error instanceof AssetSourceChangedError){
                        throw new PngCardSourceChanged('the card file changed while an asset was saved', error)
                    }
                    throw error
                }
            }
        })

        if(plan.kind === 'tavern'){
            const imgp = await saveAsset(img)
            markBootWrite()
            DBState.db.characters.push(convertOffSpecCards(plan.card, imgp))
            alertNormal(language.importedCharacter)
            return {kind: 'imported', index: DBState.db.characters.length - 1}
        }
        const result = await importCharacterCardSpec(plan.card, img, "normal", assets, null, false, true)
        return cardSpecOutcome(result, DBState.db.characters.length - 1)
    } catch (error) {
        if(error instanceof PngCardSourceChanged){
            console.error(error)
            return refusedOutcome(language.cardFileChanged)
        }
        throw error
    }
}
// The last `?realm=` path seen without acceptance, drained by
// handlePendingRealmLink() once boot reaches loadedStore.
let pendingRealmPath: string | null = null

async function fetchRealmInfo(realmPath: string): Promise<hubType> {
    const res = await fetch(`${hubURL}/hub/info/${realmPath}`)
    if(res.status !== 200){
        throw new Error(await res.text())
    }

    return await res.json()
}

function canAccessRealmCreator(creator?: string): boolean {
    if(isRealmCreatorBlocked(DBState.db.blockedRealmCreators ?? [], creator)){
        alertNormal(language.realmCreatorBlocked)
        return false
    }

    return true
}

export const getRealmInfo = async (realmPath:string): Promise<'consent'|void> => {
    const url = new URL(location.href);
    url.searchParams.delete('realm');
    window.history.replaceState(null, '', url.toString());

    if(!isUpstreamAccepted()){
        // `publishUpstreamAccepted()` (`src/ts/upstreamAgreement.ts`) makes a subscribed
        // `upstreamAccepted` agree with this fresh read, so a view that cached a stale `true`
        // before this check ran is corrected rather than left showing accepted content it has no
        // real access to.
        publishUpstreamAccepted()
        pendingRealmPath = realmPath
        return 'consent'
    }

    try {
        const realmInfo = await fetchRealmInfo(realmPath)
        if(!canAccessRealmCreator(realmInfo.creator)){
            return
        }
        showRealmInfoStore.set(realmInfo)
    } catch (error) {
        alertError(error)
    }
}

/**
 * Drains a `?realm=` path recorded by `getRealmInfo` while the upstream-
 * services agreement had not yet been given. A no-op with nothing pending.
 * Clears the pending path before asking, so a decline never leaves a stale
 * path for a later call to act on.
 */
export async function handlePendingRealmLink(): Promise<void> {
    const path = pendingRealmPath
    if(!path){
        return
    }
    pendingRealmPath = null
    if(!await askUpstreamAgreement()){
        return
    }
    await getRealmInfo(path)
}

export const showRealmInfoStore:Writable<null|hubType> = writable(null)

type ClassifiedImport = {kind: 'card'|'preset'|'module', name: string}
type ShareIndexEntry = {key: string, name: string, type: string}

//A file's kind is decided by its name suffix, compared without regard to case, whatever the form field or link it came from.
//The returned name carries the lower-case suffix because the importers compare suffixes case-sensitively.
const importSuffixes:Array<[string, ClassifiedImport['kind']]> = [
    ['.charx', 'card'], ['.png', 'card'], ['.jpg', 'card'], ['.jpeg', 'card'], ['.json', 'card'],
    ['.risupreset', 'preset'], ['.risup', 'preset'], ['.preset', 'preset'],
    ['.risum', 'module'],
]
const importTypeSuffixes:{[type:string]:string} = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'application/json': '.json',
}

function classifyImportFile(name:string, type:string):ClassifiedImport|null {
    const lower = name.toLowerCase()
    for(const [suffix, kind] of importSuffixes){
        if(lower.endsWith(suffix)){
            return {kind, name: name.slice(0, name.length - suffix.length) + suffix}
        }
    }
    //Octet-stream, zip and an empty type say nothing about the kind, so only these types stand in for a missing suffix.
    const typeSuffix = importTypeSuffixes[type.split(';')[0].trim().toLowerCase()]
    return typeSuffix ? {kind: 'card', name: name + typeSuffix} : null
}

//A share index lists only files stored under its own share id.
function parseShareIndex(value:{files?: Partial<ShareIndexEntry>[]}|null, id:string):ShareIndexEntry[]|null {
    if(!value || !Array.isArray(value.files)){
        return null
    }
    const entries:ShareIndexEntry[] = []
    const keyPattern = new RegExp(`^/sw/share/${id.replace(/[^0-9a-z-]/gi, '')}/[0-9]+$`)
    for(const entry of value.files){
        if(!entry || typeof entry.key !== 'string' || !keyPattern.test(entry.key) || typeof entry.name !== 'string' || typeof entry.type !== 'string'){
            return null
        }
        entries.push({key: entry.key, name: entry.name, type: entry.type})
    }
    return entries
}

export async function characterURLImport() {
    const realmPath = (new URLSearchParams(location.search)).get('realm')
    try {
        if(realmPath){
           getRealmInfo(realmPath)
        }
    } catch (error) {
        
    }

    const charPath = (new URLSearchParams(location.search)).get('charahub')
    try {
        if(charPath){
            alertWait(language.alerts.loadingFromChub)
            const url = new URL(location.href);
            url.searchParams.delete('charahub');
            window.history.pushState(null, '', url.toString());
            const chara = await fetch("https://api.chub.ai/api/characters/download", {
                method: "POST",
                body: JSON.stringify({
                    "format": "tavern",
                    "fullPath": charPath,
                    "version": "main"
                }),
                headers: {
                    "content-type": "application/json"
                }
            })
            if(!chara.ok){
                alertError(language.errors.noData)
            }
            else{
                //A Blob-backed File has a known size and is read from the blob store, not held as one JS array.
                const busy = beginBusy('import')
                try {
                    await importCharacterProcess({
                        name: 'charahub.png',
                        data: new File([await chara.blob()], 'charahub.png', {type: 'image/png'})
                    })
                    checkCharOrder()
                } finally {
                    busy.end()
                }
            }
        }
    } catch (error) {
        alertError(language.errors.noData)
    }


    const hash = location.hash
    if(hash.startsWith('#import=')){
        location.hash = ''
        const url = hash.replace('#import=', '')
        const busy = beginBusy('import')
        try {
            const res = await fetch(url, {
                method: 'GET',
            })
            if(!res.ok){
                alertError(language.errors.noData)
            }
            else{
                const fileName = getFileName(res)
                //A Blob-backed File has a known size and is read from the blob store, not held as one JS array.
                const blob = await res.blob()
                await importFiles([classifiedImport(fileName, fileName, '', async () => new File([blob], fileName, {type: blob.type}))])
            }
        } catch (error) {
            alertError(language.errors.noData)
        } finally {
            busy.end()
        }
    }
    //No outcome of the Chub, #import=, #import_module= or #import_preset= links ends the start-up work below.
    //The inline links are cleared once read, so a reload that keeps the fragment does not import them again.
    if(hash.startsWith('#import_module=') || hash.startsWith('#import_preset=')){
        window.history.replaceState(null, '', location.pathname + location.search)
    }
    if(hash.startsWith('#import_module=')){
        try {
            const data = hash.replace('#import_module=', '')
            const importData = JSON.parse(Buffer.from(decodeURIComponent(data), 'base64').toString('utf-8'))
            importData.id = v4()

            if(!importData.lowLevelAccess || await alertConfirm(language.lowLevelAccessConfirm)){
                markBootWrite()
                DBState.db.modules.push(importData)
                alertNormal(language.successImport)
                SettingsMenuIndex.set(14)
                settingsOpen.set(true)
            }
        } catch (error) {
            alertError(error)
        }
    }
    else if(hash.startsWith('#import_preset=')){
        const busy = beginBusy('import')
        try {
            const data = hash.replace('#import_preset=', '')
            const importData =Buffer.from(decodeURIComponent(data), 'base64')
            markBootWrite()
            await importPreset({
                name: 'imported.risupreset',
                data: importData
            })
            SettingsMenuIndex.set(1)
            settingsOpen.set(true)
        } catch (error) {
            alertError(error)
        } finally {
            busy.end()
        }
    }
    //A failure while receiving a share never stops the rest of the start-up work below.
    const shareId = /^#share=([0-9]+-[0-9a-f-]+)$/i.exec(hash)?.[1]
    if(shareId || hash === '#share-empty' || hash === '#share-failed'){
        try {
            await consumeShare(hash, shareId)
        } catch (error) {
            alertError(language.shareFailed)
        }
    }
    if ("launchQueue" in window) {
        //Every file is attempted; what did not import is shown once at the end. The consumer hands back the promise of that work.
        const handleFiles = (files:FileSystemFileHandle[]) => importFiles(
            files.map((f) => classifiedImport(f.name, f.name, '', () => f.getFile()))
        ).catch((error) => alertError(error))
        //@ts-expect-error launchQueue is File Handling API for PWA, not yet in TypeScript's Window interface
        window.launchQueue.setConsumer((launchParams) => {
            //The page before an idle reload has already imported whatever launched it; a browser that hands those files to the new page must not import them twice.
            if (wasBootedByIdleReload()) {
                return
            }
            if (launchParams.files && launchParams.files.length) {
                const files = launchParams.files as FileSystemFileHandle[]
                return handleFiles(files)
            }
        });
    }

    function clearShareHash() {
        window.history.replaceState(null, '', location.pathname + location.search)
    }

    //Exactly one caller wins the claim of a share's index; every other caller finds nothing and imports nothing.
    //The share's stored files are removed afterwards whether or not the imports succeeded.
    async function consumeShare(shareHash:string, id:string|undefined) {
        if(!id){
            clearShareHash()
            alertError(shareHash === '#share-empty' ? language.shareEmpty : language.shareFailed)
            return
        }
        const base = `/sw/share/${id}`
        let claim:Response
        try {
            claim = await fetch(`${base}/index`, {method: 'DELETE'})
        } catch (error) {
            clearShareHash()
            alertError(language.shareFailed)
            return
        }
        clearShareHash()
        if(claim.status !== 200){
            alertError(language.shareNotFound)
            return
        }
        try {
            let entries:ShareIndexEntry[]|null = null
            try {
                entries = parseShareIndex(await claim.json(), id)
            } catch (error) {}
            if(!entries){
                alertError(language.shareInvalid)
                return
            }
            await importFiles(entries.map((entry) => classifiedImport(entry.name, entry.name, entry.type, async (kind) => {
                const res = await fetch(entry.key)
                if(!res.ok){
                    return null
                }
                //A Blob-backed File has a known size and is read from the blob store, not held as one JS array.
                return new File([await res.blob()], kind.name, {type: entry.type})
            })))
        } finally {
            try {
                await fetch(base, {method: 'DELETE'})
            } catch (error) {}
        }
    }

    function getFileName(res : Response) : string {
        return getFromContent(res.headers.get('content-disposition')) || getFromURL(res.url);
    
        function getFromContent(contentDisposition : string) {
            if (!contentDisposition) return null;
            const pattern = /filename\*=UTF-8''([^"';\n]+)|filename[^;\n=]*=["']?([^"';\n]+)["']?/;
            const matches = contentDisposition.match(pattern);
            if (matches) {
                if (matches[1]) {
                    return decodeURIComponent(matches[1]);
                } else if (matches[2]) {
                    return matches[2];
                }
            }
            return null;
        }
        
        function getFromURL(url : string) : string {
            try {
                const path = new URL(url).pathname;
                return path.substring(path.lastIndexOf('/') + 1);
            } catch {
                return "";
            }
        }
    }
}


function convertOffSpecCards(charaData:OldTavernChar|CharacterCardV2Risu, imgp:string|undefined = undefined):character{
    const data = charaData.spec_version === '2.0' ? charaData.data : charaData
    const charbook = charaData.spec_version === '2.0' ? charaData.data.character_book : null
    let lorebook:loreBook[] = []
    let loresettings:undefined|loreSettings = undefined
    let loreExt:undefined|any = undefined
    if(charbook){
        const a = convertCharbook({
            lorebook,
            charbook,
            loresettings,
            loreExt
        })

        lorebook = a.lorebook
        loresettings = a.loresettings
        loreExt = a.loreExt
    }

    return {
        name: data.name ?? 'unknown name',
        firstMessage: data.first_mes ?? 'unknown first message',
        desc:  data.description ?? '',
        notes: '',
        chats: [{
            id: uuidv4(),
            message: [],
            note: '',
            name: 'Chat 1',
            localLore: []
        }],
        chatPage: 0,
        image: imgp,
        emotionImages: [],
        bias: [],
        globalLore: lorebook,
        viewScreen: 'none',
        chaId: uuidv4(),
        sdData: defaultSdDataFunc(),
        utilityBot: false,
        customscript: [],
        exampleMessage: data.mes_example,
        creatorNotes:'',
        systemPrompt: (charaData.spec_version === '2.0' ? charaData.data.system_prompt : '') ?? '',
        postHistoryInstructions: (charaData.spec_version === '2.0' ? charaData.data.post_history_instructions : '') ?? '',
        alternateGreetings:[],
        tags:[],
        creator:"",
        characterVersion: '',
        personality: data.personality ?? '',
        scenario:data.scenario ?? '',
        firstMsgIndex: -1,
        replaceGlobalNote: "",
        triggerscript: [],
        additionalText: '',
        loreExt: loreExt,
        loreSettings: loresettings,
        chatFolders: []
        
    }
}

export async function exportChar(charaID:number):Promise<string> {
    const db = getDatabase({snapshot: true})
    let char = safeStructuredClone(db.characters[charaID])

    if(char.type === 'group'){
        return ''
    }

    if(!char.image){
        const res = await fetch('/none.webp')
        const data = new Uint8Array(await res.arrayBuffer())
        char.image = await saveAsset(data)
    }

    const option = await alertCardExport()
    if(option.type === ''){
        exportCharacterCard(char, option.type2 === 'json' ? 'json' : (option.type2 === 'charx' ? 'charx' : option.type2 === 'charxJpeg' ? 'charxJpeg' : 'png'), {spec: 'v3'})
    }
    else if(option.type === 'ccv2'){
        exportCharacterCard(char,'png', {spec: 'v2'})
    }
    else if(option.type === 'realm'){
        await openRealmUpload('character')
    }
    else{
        return option.type
    }
    return ''
}

/**
 * The single opener for the Realm upload frame (`ShowRealmFrameStore`),
 * shared by the export dialog's Realm option and every character/preset
 * share button. It asks for the upstream-services agreement first
 * (MC-086); declining leaves the store untouched. Uploading a character that
 * already has a `realmId` then creates a NEW Realm listing, since editing an
 * existing listing in-app is not supported -- so that case alone shows a
 * second confirm, and declining it likewise leaves the store untouched. A
 * preset target, and a character with no `realmId` yet, upload once the
 * agreement is given, without the second confirm.
 */
export async function openRealmUpload(target: string): Promise<void> {
    if(!await askUpstreamAgreement()){
        return
    }
    if(target === 'character'){
        const db = getDatabase()
        const selected = db.characters[get(selectedCharID)]
        if(selected?.realmId){
            if(!await alertConfirm(language.realmNewListingConfirm)){
                return
            }
        }
    }
    ShowRealmFrameStore.set(target)
}


//Resolves to `null` when `card` is not a v2 or v3 card, to `false` when the user declined the low-level-access prompt, and otherwise to the card added (`true`), or with `returnValue` to the character built and not added.
//A caller that has already asked the low-level-access prompt for this card passes `lowLevelAccessAsked`, so the user is asked once.
async function importCharacterCardSpec<T extends boolean = false>(card:CharacterCardV2Risu|CharacterCardV3, img?:Uint8Array, mode:'hub'|'normal' = 'normal', assetDict:{[key:string]:string} = {}, overrideLorebook: loreBook[] = null, returnValue:T = false as T, lowLevelAccessAsked:boolean = false):Promise<T extends true ? character|false|null : boolean|null>{
    if(!card ||(card.spec !== 'chara_card_v2' && card.spec !== 'chara_card_v3' )){
        return null
    }

    console.log(`Importing ${card.spec}, mode is ${mode}`)

    const data = card.data
    let im = img ? await saveAsset(img) : undefined
    let db = DBState.db

    const risuext = safeStructuredClone(data.extensions.risuai)
    let emotions:[string, string][] = []
    let bias:[string, number][] = []
    let viewScreen: "none" | "emotion" | "imggen" = 'none'
    let customScripts:customscript[] = []
    let utilityBot = false
    let sdData = defaultSdDataFunc()
    let extAssets:[string,string,string][] = []
    let ccAssets:{
        type: string
        uri: string
        name: string
        ext: string
    }[] = []
    
    let vits:null|OnnxModelFiles = null
    if(risuext && card.spec === 'chara_card_v2'){
        if(risuext.emotions){
            for(let i=0;i<risuext.emotions.length;i++){
                alertStore.set({
                    type: 'progress',
                    msg: language.alerts.loadingEmotions,
                    submsg: (i / risuext.emotions.length * 100).toFixed(2)
                })
                await sleep(10)
                if(risuext.emotions[i][1].startsWith('__asset:')){
                    const key = risuext.emotions[i][1].replace('__asset:', '')
                    const imgp = assetDict[key]
                    if(!imgp){
                        throw new Error(fillLang(language.errors.importAssetNotFound, { key }))
                    }
                    emotions.push([risuext.emotions[i][0],imgp])
                    continue
                }
                const imgp = await saveAsset(mode === 'hub' ? (await getHubResources(risuext.emotions[i][1])) : Buffer.from(risuext.emotions[i][1], 'base64'))
                emotions.push([risuext.emotions[i][0],imgp])
            }
        }
        if(risuext.additionalAssets){
            for(let i=0;i<risuext.additionalAssets.length;i++){
                alertStore.set({
                    type: 'progress',
                    msg: language.alerts.loadingAssets,
                    submsg: (i / risuext.additionalAssets.length * 100).toFixed(2)
                })

                if(i % 100 === 0){
                    await sleep(10)
                }
                let fileName = ''
                if(risuext.additionalAssets[i].length >= 3)
                    fileName = risuext.additionalAssets[i][2]
                if(risuext.additionalAssets[i][1].startsWith('__asset:')){
                    const key = risuext.additionalAssets[i][1].replace('__asset:', '')
                    const imgp = assetDict[key]
                    if(!imgp){
                        throw new Error(fillLang(language.errors.importAssetNotFound, { key }))
                    }
                    extAssets.push([risuext.additionalAssets[i][0],imgp,fileName])
                    continue
                }
                const imgp = await saveAsset(mode === 'hub' ? (await getHubResources(risuext.additionalAssets[i][1])) :Buffer.from(risuext.additionalAssets[i][1], 'base64'), '', fileName)
                extAssets.push([risuext.additionalAssets[i][0],imgp,fileName])
            }
        }
        if(risuext.vits){
            const keys = Object.keys(risuext.vits)
            for(let i=0;i<keys.length;i++){
                alertStore.set({
                    type: 'progress',
                    msg: language.alerts.loadingVits,
                    submsg: (i / keys.length * 100).toFixed(2)
                })
                await sleep(10)
                const key = keys[i]
                if(risuext.vits[key].startsWith('__asset:')){
                    const rkey = risuext.vits[key].replace('__asset:', '')
                    const imgp = assetDict[rkey]
                    if(!imgp){
                        throw new Error(fillLang(language.errors.importAssetNotFound, { key: rkey }))
                    }
                    risuext.vits[key] = imgp
                    continue
                }
                const imgp = await saveAsset(mode === 'hub' ? (await getHubResources(risuext.vits[key])) : Buffer.from(risuext.vits[key], 'base64'))
                risuext.vits[key] = imgp
            }

            if(keys.length > 0){
                vits = {
                    name: "Imported VITS",
                    files: risuext.vits,
                    id: uuidv4().replace(/-/g, '')
                }
            }


        }

        if(risuext){
            bias = risuext.bias ?? bias
            viewScreen = risuext.viewScreen ?? viewScreen
            customScripts = risuext.customScripts ?? customScripts
            utilityBot = risuext.utilityBot ?? utilityBot
            sdData = risuext.sdData ?? sdData
        }
    }
    if(card.spec === 'chara_card_v3'){
        const data = card.data //required for type checking
        if(data.assets){
            for(let i=0;i<data.assets.length;i++){
                alertStore.set({
                    type: 'progress',
                    msg: language.alerts.loadingAssets,
                    submsg: (i / data.assets.length * 100).toFixed(2)
                })
                if(i % 100 === 0){
                    await sleep(10)
                }
                let fileName = ''
                let imgp = ''
                if(data.assets[i].name){
                    fileName = data.assets[i].name
                }
                if(data.assets[i].uri.startsWith('__asset:')){
                    const key = data.assets[i].uri.replace('__asset:', '')
                    imgp = assetDict[key]
                    if(!imgp){
                        throw new Error(fillLang(language.errors.importAssetNotFound, { key }))
                    }
                }
                else if(data.assets[i].uri === 'ccdefault:'){
                    imgp = im
                }
                else if(data.assets[i].uri.startsWith('embeded://')){
                    const key = data.assets[i].uri.replace('embeded://', '')
                    imgp = assetDict[key]
                    if(!imgp){
                        throw new Error(fillLang(language.errors.importAssetNotFound, { key }))
                    }
                }
                else if(data.assets[i].uri.startsWith('data:')){
                    //data uri
                    const b64 = data.assets[i].uri.split(',')[1]
                    if(b64.length < 50 * 1024 * 1024){
                        imgp = await saveAsset(Buffer.from(b64, 'base64'))
                    }
                    else{
                        alertError(language.errors.dataUriTooLarge)
                        continue
                    }
                }
                else{
                    continue
                }
                if(data.assets[i].type === 'emotion'){
                    emotions.push([fileName,imgp])
                }
                else if(data.assets[i].type === 'x-risu-asset'){
                    extAssets.push([fileName,imgp, data.assets[i].ext ?? 'unknown'])
                }
                else if(data.assets[i].type === 'icon' && data.assets[i].name === 'main'){
                    im = imgp
                }
                else{
                    ccAssets.push({
                        type: data.assets[i].type ?? 'asset',
                        uri: imgp,
                        name: fileName,
                        ext: data.assets[i].ext ?? 'unknown'
                    })
                }
            }
        }

        if(risuext){
            bias = risuext.bias ?? bias
            viewScreen = risuext.viewScreen ?? viewScreen
            customScripts = risuext.customScripts ?? customScripts
            utilityBot = risuext.utilityBot ?? utilityBot
            sdData = risuext.sdData ?? sdData
        }
    }

    if(risuext && risuext?.lowLevelAccess && !lowLevelAccessAsked){
        const conf = await alertConfirm(language.lowLevelAccessConfirm)
        if(!conf){
            return false
        }
    }
    const charbook = data.character_book
    let lorebook:loreBook[] = overrideLorebook ?? []
    let loresettings:undefined|loreSettings = undefined
    let loreExt:undefined|any = undefined
    if(charbook){
        const a = convertCharbook({
            lorebook: overrideLorebook ? [] : lorebook,
            charbook,
            loresettings,
            loreExt
        })

        if(!overrideLorebook){
            lorebook = a.lorebook
        }
        loresettings = a.loresettings
        loreExt = a.loreExt
    }

    let ext = safeStructuredClone(data?.extensions ?? {})

    for(const key in ext){
        if(key === 'risuai'){
            delete ext[key]
        }
        if(key === 'depth_prompt'){
            delete ext[key]
        }
    }

    let char:character = {
        name: data.name ?? '',
        firstMessage: data.first_mes ?? '',
        desc: data.description ?? '',
        notes: '',
        chats: [{
            id: uuidv4(),
            message: [],
            note: '',
            name: 'Chat 1',
            localLore: []
        }],
        chatPage: 0,
        image: im,
        emotionImages: emotions,
        bias: bias,
        globalLore: lorebook, //lorebook
        viewScreen: viewScreen,
        chaId: uuidv4(),
        sdData: sdData,
        utilityBot: utilityBot,
        customscript: customScripts,
        exampleMessage: data.mes_example ?? '',
        creatorNotes:data.creator_notes ?? '',
        systemPrompt:data.system_prompt ?? '',
        postHistoryInstructions:'',
        alternateGreetings:data.alternate_greetings ?? [],
        tags:data.tags ?? [],
        creator:data.creator ?? '',
        characterVersion: `${data.character_version}` || '',
        personality:data.personality ?? '',
        scenario:data.scenario ?? '',
        firstMsgIndex: -1,
        removedQuotes: false,
        loreSettings: loresettings,
        loreExt: loreExt,
        additionalData: {
            tag: data.tags ?? [],
            creator: data.creator,
            character_version: data.character_version
        },
        additionalAssets: extAssets,
        replaceGlobalNote: data.post_history_instructions ?? '',
        backgroundHTML: data?.extensions?.risuai?.backgroundHTML,
        license: data?.extensions?.risuai?.license,
        triggerscript: data?.extensions?.risuai?.triggerscript ?? [],
        private: data?.extensions?.risuai?.private ?? false,
        additionalText: data?.extensions?.risuai?.additionalText ?? '',
        virtualscript: '', //removed dude to security issue
        extentions: ext ?? {},
        largePortrait: data?.extensions?.risuai?.largePortrait ?? (!data?.extensions?.risuai),
        lorePlus: data?.extensions?.risuai?.lorePlus ?? false,
        inlayViewScreen: data?.extensions?.risuai?.inlayViewScreen ?? false,
        newGenData: data?.extensions?.risuai?.newGenData ?? undefined,
        vits: vits,
        ttsMode: vits ? 'vits' : 'normal',
        imported: true,
        source: card?.data?.extensions?.risuai?.source ?? [],
        ccAssets: ccAssets,
        lowLevelAccess: risuext?.lowLevelAccess ?? false,
        defaultVariables: data?.extensions?.risuai?.defaultVariables ?? '',
        chatFolders: [],
        prebuiltAssetCommand: data?.extensions?.risuai?.prebuiltAssetCommand ?? '',
        prebuiltAssetExclude: data?.extensions?.risuai?.prebuiltAssetExclude ?? [],
        prebuiltAssetStyle: data?.extensions?.risuai?.prebuiltAssetStyle ?? '',
        customModuleToggle: data?.extensions?.risuai?.toggles ?? {},
        moduleNamespace: data?.extensions?.risuai?.moduleNamespace,
        hideChatIcon: data?.extensions?.risuai?.hideChatIcon ?? false,
    }

    if(card.spec === 'chara_card_v3'){
        char.group_only_greetings = card.data.group_only_greetings ?? []
        char.nickname = card.data.nickname ?? ''
        char.source = card.data.source ?? card.data?.extensions?.risuai?.source ?? []
        char.creation_date = card.data.creation_date ?? 0
        char.modification_date = card.data.modification_date ?? 0
    }

    if(returnValue){
        return char as any
    }

    markBootWrite()
    db.characters.push(char)
    alertNormal(language.importedCharacter)
    return true as any

}

function convertCharbook(arg:{
    lorebook:loreBook[]
    charbook:CharacterBook
    loresettings:loreSettings
    loreExt:any
}){
    let {lorebook, loresettings, loreExt, charbook} = arg
    if((!checkNullish(charbook.recursive_scanning)) &&
        (!checkNullish(charbook.scan_depth)) &&
        (!checkNullish(charbook.token_budget))){
        loresettings = {
            tokenBudget:charbook.token_budget,
            scanDepth:charbook.scan_depth,
            recursiveScanning: charbook.recursive_scanning,
            fullWordMatching: charbook?.extensions?.risu_fullWordMatching ?? false,
        }
    }

    loreExt = charbook.extensions

    for(const book of charbook.entries){
        let content = book.content

        if(book.use_regex && !book.keys?.[0]?.startsWith('/')){
            book.use_regex = false
        }

        //extention migration
        const extensions = book.extensions ?? {}

        if(extensions.useProbability && extensions.probability !== undefined && extensions.probability !== 100){
            content = `@@probability ${extensions.probability}\n` + content
            delete extensions.useProbability
            delete extensions.probability
        }
        if(extensions.position === 4 && typeof extensions.depth === 'number' && typeof(extensions.role) === 'number'){
            content = `@@depth ${extensions.depth}\n@@role ${['system','user','assistant'][extensions.role]}\n` + content
            delete extensions.position
            delete extensions.depth
            delete extensions.role
        }
        if(typeof(extensions.selectiveLogic) === 'number' && book.secondary_keys && book.secondary_keys.length > 0){
            switch(extensions.selectiveLogic){
                case 0:{
                    if(!book.secondary_keys || book.secondary_keys.length === 0){
                        book.selective = false
                    }
                    break
                }
                case 1:{
                    book.selective = false
                    content = `@@exclude_keys_all ${book.secondary_keys.join(',')}\n` + content
                    break
                }
                case 2:{
                    book.selective = false
                    for(const secKey of book.secondary_keys){
                        content = `@@exclude_keys ${secKey}\n` + content
                    }
                    break
                }
                case 3:{
                    book.selective = false
                    for(const secKey of book.secondary_keys){
                        content = `@@additional_keys ${secKey}\n` + content
                    }
                    break
                }
            }
        }
        if(typeof extensions.delay === 'number' && extensions.delay > 0){
            content = `@@activate_only_after ${extensions.delay}\n` + content
            delete extensions.delay
        }
        if(extensions.match_whole_words === true){
            content = `@@match_full_word\n` + content
            delete extensions.match_whole_words
        }
        if(extensions.match_whole_words === false){
            content = `@@match_partial_word\n` + content
            delete extensions.match_whole_words
        }

        lorebook.push({
            key: book.keys.join(', '),
            secondkey: book.secondary_keys?.join(', ') ?? '',
            insertorder: book.insertion_order,
            comment: book.name ?? book.comment ?? "",
            content: content,
            mode: (book.mode as any) ?? "normal",
            alwaysActive: book.constant ?? false,
            selective: book.selective ?? false,
            extentions: {...extensions, risu_case_sensitive: book.case_sensitive},
            activationPercent: book.extensions?.risu_activationPercent,
            loreCache: book.extensions?.risu_loreCache ?? null,
            useRegex: book.use_regex ?? false,
            folder: book.folder
        })
    }

    return {
        lorebook,
        loresettings,
        loreExt
    }
}



function createBaseV2(char:character) {
    
    let charBook:charBookEntry[] = []
    for(const lore of char.globalLore){
        let ext:{
            risu_case_sensitive?: boolean;
            risu_activationPercent?: number
            risu_loreCache?: {
                key:string
                data:string[]
            }
        } = safeStructuredClone(lore.extentions ?? {})

        let caseSensitive = ext.risu_case_sensitive ?? false
        ext.risu_activationPercent = lore.activationPercent
        ext.risu_loreCache = lore.loreCache

        charBook.push({
            keys: lore.key.split(',').map(r => r.trim()),
            secondary_keys: lore.selective ? lore.secondkey.split(',').map(r => r.trim()) : undefined,
            content: lore.content,
            extensions: ext,
            enabled: true,
            insertion_order: lore.insertorder,
            constant: lore.alwaysActive,
            selective:lore.selective,
            name: lore.comment,
            comment: lore.comment,
            case_sensitive: caseSensitive,
            mode: lore.mode ?? "normal",
            folder: lore.folder,
        })
    }
    char.loreExt ??= {}

    char.loreExt.risu_fullWordMatching = char.loreSettings?.fullWordMatching ?? false

    const card:CharacterCardV2Risu = {
        spec: "chara_card_v2",
        spec_version: "2.0",
        data: {
            name: char.name,
            description: char.desc ?? '',
            personality: char.personality ?? '',
            scenario: char.scenario ?? '',
            first_mes: char.firstMessage ?? '',
            mes_example: char.exampleMessage ?? '',
            creator_notes: char.creatorNotes ?? '',
            system_prompt: char.systemPrompt ?? '',
            post_history_instructions: char.replaceGlobalNote ?? '',
            alternate_greetings: char.alternateGreetings ?? [],
            character_book: {
                scan_depth: char.loreSettings?.scanDepth,
                token_budget: char.loreSettings?.tokenBudget,
                recursive_scanning: char.loreSettings?.recursiveScanning,
                extensions: char.loreExt ?? {},
                entries: charBook
            },
            tags: char.tags ?? [],
            creator: char.additionalData?.creator ?? '',
            character_version: `${char.additionalData?.character_version}` || '',
            extensions: {
                risuai: {
                    // emotions: char.emotionImages,
                    bias: char.bias,
                    viewScreen: char.viewScreen,
                    customScripts: char.customscript,
                    utilityBot: char.utilityBot,
                    sdData: char.sdData,
                    // additionalAssets: char.additionalAssets,
                    backgroundHTML: char.backgroundHTML,
                    license: char.license,
                    triggerscript: char.triggerscript,
                    additionalText: char.additionalText,
                    virtualscript: '', //removed dude to security issue
                    largePortrait: char.largePortrait,
                    lorePlus: char.lorePlus,
                    inlayViewScreen: char.inlayViewScreen,
                    newGenData: char.newGenData,
                    vits: {}
                },
                depth_prompt: char.depth_prompt
            }
        }
    }

    if(char.extentions){
        for(const key in char.extentions){
            if(key === 'risuai' || key === 'depth_prompt'){
                continue
            }
            card.data.extensions[key] = char.extentions[key]
        }
    }
    return card
}


export function exportCharacterCard(char:character, type:'png'|'json'|'charx'|'charxJpeg' = 'png', arg:{
    password?:string
    writer?:LocalWriter|VirtualWriter,
    spec?:'v2'|'v3'
} = {}) {
    return withBusy('export', () => writeCharacterCard(char, type, arg))
}

async function writeCharacterCard(char:character, type:'png'|'json'|'charx'|'charxJpeg', arg:{
    password?:string
    writer?:LocalWriter|VirtualWriter,
    spec?:'v2'|'v3'
}) {
    let img = await readImage(char.image)
    const spec:'v2'|'v3' = arg.spec ?? 'v2' //backward compatibility
    try{
        char.image = ''
        img = type === 'png' ? (await reencodeImage(img)) : img
        const localWriter = arg.writer ?? (new LocalWriter())
        if(!arg.writer && type !== 'json'){
            const nameExt = {
                'png': ['Image File', 'png'],
                'json': ['JSON File', 'json'],
                'charx': ['CharX File', 'charx'],
                'charxJpeg': ['CharX Embedded Jpeg', 'jpeg']
            }
            const ext = nameExt[type]
            await (localWriter as LocalWriter).init(ext[0], [ext[1]])
        }
        const writer = (type === 'charx' || type === 'charxJpeg') ? (new CharXWriter(localWriter)) : type === 'json' ? (new BlankWriter()) : (new PngChunk.streamWriter(img, localWriter))
        await writer.init()
        if(writer instanceof CharXWriter && type === 'charxJpeg'){
            await writer.writeJpeg(img)
        }
        let assetIndex = 0
        if(spec === 'v2'){
            const card = await createBaseV2(char)
            if(card.data.extensions.risuai.emotions && card.data.extensions.risuai.emotions.length > 0){
                for(let i=0;i<card.data.extensions.risuai.emotions.length;i++){
                    alertStore.set({
                        type: 'progress',
                        msg: language.alerts.addingEmotions,
                        submsg: (i / card.data.extensions.risuai.emotions.length * 100).toFixed(2)
                    })
                    const key = card.data.extensions.risuai.emotions[i][1]
                    const rData = await readImage(key)
                    const b64encoded = Buffer.from(await compressImage(rData)).toString('base64')
                    assetIndex++
                    card.data.extensions.risuai.emotions[i][1] = `__asset:${assetIndex}`
                    await writer.write("chara-ext-asset_:" + assetIndex, b64encoded)
                }
            }
    
            
            if(card.data.extensions.risuai.additionalAssets && card.data.extensions.risuai.additionalAssets.length > 0){
                for(let i=0;i<card.data.extensions.risuai.additionalAssets.length;i++){
                    alertStore.set({
                        type: 'progress',
                        msg: language.alerts.addingAdditionalAssets,
                        submsg: (i / card.data.extensions.risuai.additionalAssets.length * 100).toFixed(2)
                    })
                    const key = card.data.extensions.risuai.additionalAssets[i][1]
                    const rData = await readImage(key)
                    const b64encoded = Buffer.from(await compressImage(rData)).toString('base64')
                    assetIndex++
                    card.data.extensions.risuai.additionalAssets[i][1] = `__asset:${assetIndex}`
                    await writer.write("chara-ext-asset_:" + assetIndex, b64encoded)
                }
            }
    
            if(char.vits && char.ttsMode === 'vits'){
                const keys = Object.keys(char.vits.files)
                for(let i=0;i<keys.length;i++){
                    alertStore.set({
                        type: 'progress',
                        msg: language.alerts.addingVits,
                        submsg: (i / keys.length * 100).toFixed(2)
                    })
                    const key = keys[i]
                    const rData = await loadAsset(char.vits.files[key])
                    const b64encoded = Buffer.from(rData).toString('base64')
                    assetIndex++
                    card.data.extensions.risuai.vits[key] = `__asset:${assetIndex}`
                    await writer.write("chara-ext-asset_:" + assetIndex, b64encoded)
                }
            }
            if(type === 'json'){
                await downloadFile(`${char.name.replace(/[<>:"/\\|?*\.\,]/g, "")}_export.json`, Buffer.from(JSON.stringify(card, null, 4), 'utf-8'))
                alertNormal(language.successExport)
                return
            }
    
            await sleep(10)
            alertStore.set({
                type: 'wait',
                msg: language.alerts.writingPng
            })
    
            await writer.write("chara", Buffer.from(JSON.stringify(card)).toString('base64'))     
        }
        else if(spec === 'v3'){
            const card = createBaseV3(char)
            const seenPaths = new Set<string>()
            if(card.data.assets && card.data.assets.length > 0){
                for(let i=0;i<card.data.assets.length;i++){
                    alertStore.set({
                        type: 'progress',
                        msg: language.alerts.addingCardAssets,
                        submsg: (i / card.data.assets.length * 100).toFixed(2)
                    })
                    let key = card.data.assets[i].uri
                    let rData:Uint8Array
                    if(key === 'ccdefault:' && type !== 'png'){
                        key = char.image
                        rData = img
                    }
                    else if(isKnownUri(key)){
                        continue
                    }
                    else{
                        rData = await readImage(key)
                    }
                    assetIndex++
                    if(type === 'png'){
                        const b64encoded = Buffer.from(await compressImage(rData)).toString('base64')
                        card.data.assets[i].uri = `__asset:${assetIndex}`
                        await writer.write("chara-ext-asset_:" + assetIndex, b64encoded)
                    }
                    else if(type === 'json'){
                        const b64encoded = Buffer.from(await compressImage(rData)).toString('base64')
                        card.data.assets[i].uri = `data:application/octet-stream;base64,${b64encoded}`
                    }
                    else{
                        let type = 'other'
                        let itype = 'other'
                        switch(card.data.assets[i].type){
                            case 'emotion':
                                type = 'emotion'
                                break
                            case 'background':
                                type = 'background'
                                break
                            case 'user_icon':
                                type = 'user_icon'
                                break
                            case 'icon':
                                type = 'icon'
                                break
                        }
                        switch(card.data.assets[i].ext){
                            case 'png':
                            case 'jpg':
                            case 'jpeg':
                            case 'gif':
                            case 'webp':
                            case 'avif':
                                itype = 'image'
                                break
                            case 'mp3':
                            case 'wav':
                            case 'ogg':
                            case 'flac':
                                itype = 'audio'
                                break
                            case 'mp4':
                            case 'webm':
                            case 'mov':
                            case 'avi':
                            case 'mkv':
                                itype = 'video'
                                break
                            case 'mmd':
                            case 'obj':
                                itype = 'model'
                                break
                            case 'safetensors':
                            case 'cpkt':
                            case 'onnx':
                                itype = 'ai'
                                break
                            case 'otf':
                            case 'ttf':
                            case 'woff':
                            case 'woff2':
                                itype = 'fonts'
                                break
                            case 'js':
                            case 'ts':
                            case 'lua':
                                itype = 'code'
                        }

                        let path = ''
                        let name = card.data.assets[i].name || `asset_${assetIndex}`
                        if(name.length > 100){
                            name = name.substring(0,100)
                        }
                        const ext = card.data.assets[i].ext === 'unknown' ? 'png' : card.data.assets[i].ext
                        const baseDir = card.data.assets[i].ext === 'unknown'
                            ? `assets/${type}/image`
                            : `assets/${type}/${itype}`

                        // Generate unique path to avoid duplicate filenames
                        let uniqueName = name
                        let suffix = 0
                        while(seenPaths.has(`${baseDir}/${uniqueName}.${ext}`)){
                            suffix++
                            uniqueName = `${name}_${suffix}`
                        }
                        path = `${baseDir}/${uniqueName}.${ext}`
                        seenPaths.add(path)

                        card.data.assets[i].uri = 'embeded://' + path
                        const imageType = getImageType(rData)
                        const metaPath = `x_meta/${uniqueName}.json`
                        if(imageType === 'PNG' && writer instanceof CharXWriter){
                            const metadatas:Record<string,string> = {}
                            const gen = PngChunk.readGenerator(rData)
                            for await (const chunk of gen){
                                if(!chunk || chunk instanceof AppendableBuffer){
                                    continue
                                }
                                metadatas[chunk.key] = chunk.value
                            }
                            if(Object.keys(metadatas).length > 0){
                                await writer.write(metaPath, Buffer.from(JSON.stringify(metadatas, null, 4)), 6)
                            }
                            else{
                                await writer.write(metaPath, Buffer.from(JSON.stringify({
                                    'type': imageType
                                }), 'utf-8'), 6)
                            }
                        }
                        else{
                            await writer.write(metaPath, Buffer.from(JSON.stringify({
                                'type': imageType
                            }), 'utf-8'), 6)
                        }
                        await writer.write(path, Buffer.from(await compressImage(rData)))
                    }
                }
            }
            if(type === 'json'){
                await downloadFile(`${char.name.replace(/[<>:"/\\|?*\.\,]/g, "")}_export.json`, Buffer.from(JSON.stringify(card, null, 4), 'utf-8'))
                alertNormal(language.successExport)
                return
            }

            await sleep(10)
            alertStore.set({
                type: 'wait',
                msg: language.alerts.writingPng
            })
    
            if(type === 'charx' || type === 'charxJpeg'){
                const md:RisuModule = {
                    name: `${char.name} Module`,
                    description: "Module for " + char.name,
                    id: v4(),
                    trigger: card.data.extensions.risuai.triggerscript ?? [],
                    regex: card.data.extensions.risuai.customScripts ?? [],
                    lorebook: char.globalLore ?? [],
                }
                delete card.data.extensions.risuai.triggerscript
                delete card.data.extensions.risuai.customScripts
                await writer.write("module.risum", await exportModuleLegacy(md, {
                    alertEnd: false,
                    saveData: false
                }))
                await writer.write("card.json", Buffer.from(JSON.stringify(card, null, 4)))
            }
            else{
                await writer.write("ccv3", Buffer.from(JSON.stringify(card)).toString('base64'))
            }
        }
        await writer.end()

        await sleep(10)

        if(!arg.writer){
            alertNormal(language.successExport)
        }

    }
    catch(e){
        alertError(e)
    }
}

// Extended LorebookEntry with Risuai specific fields
type RisuLorebookEntry = LorebookEntry & {
    mode?: string;
    folder?: string;
}

export function createBaseV3(char:character){
    
    let charBook:RisuLorebookEntry[] = []
    let assets:Array<{
        type: string
        uri: string
        name: string
        ext: string
    }> = safeStructuredClone(char.ccAssets ?? [])

    if(char.additionalAssets){
        for(const asset of char.additionalAssets){
            assets.push({
                type: 'x-risu-asset',
                uri: asset[1],
                name: asset[0],
                ext: asset[2] || 'png'
            })
        }
    }

    if(char.emotionImages){
        for(const asset of char.emotionImages){
            assets.push({
                type: 'emotion',
                uri: asset[1],
                name: asset[0],
                ext: 'png'
            })
        }
    
        assets.push({
            type: 'icon',
            uri: 'ccdefault:',
            name: 'main',
            ext: 'png'
        })
    }

    for(const lore of char.globalLore){
        let ext:{
            risu_case_sensitive?: boolean;
            risu_activationPercent?: number
            risu_loreCache?: {
                key:string
                data:string[]
            }
        } = safeStructuredClone(lore.extentions ?? {})

        let caseSensitive = ext.risu_case_sensitive ?? false
        ext.risu_activationPercent = lore.activationPercent
        ext.risu_loreCache = lore.loreCache

        charBook.push({
            ...{
                keys: lore.key.split(',').map(r => r.trim()),
                secondary_keys: lore.selective ? lore.secondkey.split(',').map(r => r.trim()) : undefined,
                content: lore.content,
                extensions: ext,
                enabled: true,
                insertion_order: lore.insertorder,
                constant: lore.alwaysActive,
                selective:lore.selective,
                name: lore.comment,
                comment: lore.comment,
                case_sensitive: caseSensitive,
                use_regex: lore.useRegex ?? false,
            } as LorebookEntry,
            mode: lore.mode ?? "normal",
            folder: lore.folder,
        })
    }
    char.loreExt ??= {}

    char.loreExt.risu_fullWordMatching = char.loreSettings?.fullWordMatching ?? false

    const card:CharacterCardV3 = {
        spec: "chara_card_v3",
        spec_version: "3.0",
        data: {
            name: char.name,
            description: char.desc ?? '',
            personality: char.personality ?? '',
            scenario: char.scenario ?? '',
            first_mes: char.firstMessage ?? '',
            mes_example: char.exampleMessage ?? '',
            creator_notes: char.creatorNotes ?? '',
            system_prompt: char.systemPrompt ?? '',
            post_history_instructions: char.replaceGlobalNote ?? '',
            alternate_greetings: char.alternateGreetings ?? [],
            character_book: {
                scan_depth: char.loreSettings?.scanDepth,
                token_budget: char.loreSettings?.tokenBudget,
                recursive_scanning: char.loreSettings?.recursiveScanning,
                extensions: char.loreExt ?? {},
                entries: charBook
            },
            tags: char.tags ?? [],
            creator: char.additionalData?.creator ?? '',
            character_version: `${char.additionalData?.character_version}` || '',
            extensions: {
                risuai: {
                    bias: char.bias,
                    viewScreen: char.viewScreen,
                    customScripts: char.customscript,
                    utilityBot: char.utilityBot,
                    sdData: char.sdData,
                    backgroundHTML: char.backgroundHTML,
                    license: char.license,
                    triggerscript: char.triggerscript,
                    additionalText: char.additionalText,
                    virtualscript: '', //removed dude to security issue
                    largePortrait: char.largePortrait,
                    lorePlus: char.lorePlus,
                    inlayViewScreen: char.inlayViewScreen,
                    newGenData: char.newGenData,
                    vits: {},
                    lowLevelAccess: char.lowLevelAccess ?? false,
                    defaultVariables: char.defaultVariables ?? '',
                    prebuiltAssetCommand: char.prebuiltAssetCommand ?? '',
                    prebuiltAssetExclude: char.prebuiltAssetExclude ?? [],
                    prebuiltAssetStyle: char.prebuiltAssetStyle ?? '',
                    toggles: char.customModuleToggle ?? '',
                    moduleNamespace: char.moduleNamespace,
                    hideChatIcon: char.hideChatIcon ?? false
                },
                depth_prompt: char.depth_prompt
            },
            group_only_greetings: char.group_only_greetings ?? [],
            nickname: char.nickname ?? '',
            source: char.source ?? [],
            creation_date: char.creation_date ?? 0,
            modification_date: Math.floor(Date.now() / 1000),
            assets: assets
        }
    }

    if(char.extentions){
        for(const key in char.extentions){
            if(key === 'risuai' || key === 'depth_prompt'){
                continue
            }
            card.data.extensions[key] = char.extentions[key]
        }
    }
    return card
}


export type hubType = {
    name:string
    desc: string
    download: string,
    id: string,
    img: string
    tags: string[],
    viewScreen: "none" | "emotion" | "imggen"
    hasLore:boolean
    hasEmotion:boolean
    hasAsset:boolean
    creator?:string
    creatorName?:string
    hot:number
    license:string
    authorname?:string
    original?:string
    type:string
    hidden?:boolean
}

/**
 * Discriminated result of `getRisuHub`. Replaces the old `Promise<hubType[]>` contract, which
 * collapsed every failure into an empty array before any caller could distinguish "the hub is
 * empty" from "the request failed" (`MC-056`).
 *
 * `reason` values:
 * - `offline` — `navigator.onLine === false`, checked first inside the request `try`. Only the
 *   `false` reading is trusted: it reliably means there is no network at all. A `true` reading
 *   means the device is attached to *some* network, not that the internet or the hub host is
 *   reachable, so it is never treated as a reason to skip the fetch or its error handling.
 * - `http` — a non-200 response; `status` carries the response's status code.
 * - `timeout` — the request was aborted by this function's own timer (`HUB_REQUEST_TIMEOUT_MS`),
 *   distinguished from `network` via a locally-tracked flag rather than by inspecting the thrown
 *   error's `name`, which varies by runtime. The timer can also fire while a 200 response's body
 *   is still being read, so the body-parsing catch consults the same flag before falling back to
 *   `malformed`.
 * - `malformed` — a 200 response whose body is not valid JSON, or is valid JSON that is neither
 *   a bare array nor an object with an array `cards` property. This path must always resolve a
 *   defined `RisuHubResult`, never `undefined`, or a caller's `.length` throws during render.
 * - `network` — anything else thrown (e.g. the request never reached a server at all).
 */
export type RisuHubResult =
    | { ok: true; cards: hubType[]; additionalHTML: string }
    | { ok: false; reason: 'http' | 'network' | 'timeout' | 'malformed' | 'offline' | 'consent'; status?: number }

// A manual AbortController + setTimeout, not AbortSignal.timeout: distinguishing `timeout` from
// `network` needs a local flag we control. AbortSignal.timeout gives no such handle — it only
// surfaces a `TimeoutError` name, and error names vary by runtime and should not be inspected
// (see the `timeout` case below).
const HUB_REQUEST_TIMEOUT_MS = 8000

export async function getRisuHub(arg:{
    search:string,
    page:number,
    nsfw:boolean
    sort:string
}):Promise<RisuHubResult> {
    if(!isUpstreamAccepted()){
        // `publishUpstreamAccepted()` (`src/ts/upstreamAgreement.ts`) makes a subscribed
        // `upstreamAccepted` agree with this fresh read, so a view that cached a stale `true`
        // before this check ran is corrected rather than left showing accepted content it has no
        // real access to.
        publishUpstreamAccepted()
        return { ok: false, reason: 'consent' }
    }

    const controller = new AbortController()
    let timedOut = false
    const timeoutId = setTimeout(() => {
        timedOut = true
        controller.abort()
    }, HUB_REQUEST_TIMEOUT_MS)

    try {
        if(navigator.onLine === false){
            return { ok: false, reason: 'offline' }
        }

        const search = arg.search + ' __shared'
        const stringArg = `search==${search}&&page==${arg.page}&&nsfw==${arg.nsfw}&&sort==${arg.sort}&&web==${(!isNodeServer && !isTauri) ? 'web' : 'other'}`

        const da = await fetch(hubURL + '/realm/' + encodeURIComponent(stringArg) + "?cache=30", {
            headers: {
                "x-risuai-info": appVer + ';' + (isNodeServer ? 'node' : (isTauri ? 'tauri' : 'web'))
            },
            signal: controller.signal
        })
        if(da.status !== 200){
            return { ok: false, reason: 'http', status: da.status }
        }

        // res.json() gets its own try, inside the 200 branch: a 200 whose body is not valid
        // JSON must classify as `malformed` (the server answered), not `network` (which the
        // generic catch below would otherwise report). But the timer can still fire while the
        // body is streaming — headers arrived, so status is 200, yet the abort it triggers
        // rejects this await too. Consult `timedOut` here as well, or a slow body on a large
        // realm payload gets misdiagnosed as malformed JSON when it was never read at all.
        try {
            const jso = await da.json()
            const blocked = DBState.db.blockedRealmCreators ?? []
            if(Array.isArray(jso)){
                return { ok: true, cards: filterBlockedRealmCards(jso, blocked), additionalHTML: '' }
            }
            if(jso && Array.isArray(jso.cards)){
                return { ok: true, cards: filterBlockedRealmCards(jso.cards, blocked), additionalHTML: jso.additionalHTML || '' }
            }
            return { ok: false, reason: 'malformed' }
        } catch {
            return { ok: false, reason: timedOut ? 'timeout' : 'malformed' }
        }
    } catch (error) {
        return { ok: false, reason: timedOut ? 'timeout' : 'network' }
    } finally {
        clearTimeout(timeoutId)
    }
}

export function downloadRisuHub(id:string, arg:{
    forceRedirect?: boolean
    creator?: string
} = {}) {
    return withBusy('import', () => downloadRealmCard(id, arg))
}

async function downloadRealmCard(id:string, arg:{
    forceRedirect?: boolean
    creator?: string
}) {
    try {
        if(!(await askUpstreamAgreement())){
            return
        }
        let creator = arg.creator
        if(!creator){
            try {
                const realmInfo = await fetchRealmInfo(id)
                creator = realmInfo.creator
            } catch (error) {
                alertError(error)
                return
            }
        }
        if(!canAccessRealmCreator(creator)){
            return
        }

        if(!arg.forceRedirect){
            alertStore.set({
                type: "wait",
                msg: language.alerts.downloading
            })
        }
        const res = await fetch("https://realm.risuai.net/api/v1/download/dynamic/" + id + '?cors=true', {
            headers: {
                "x-risu-api-version": "4"
            }
        })
        if(res.status !== 200){
            alertError(await res.text())
            return
        }

        if(res.headers.get('content-type') === 'image/png' || res.headers.get('content-type') === 'application/zip' || res.headers.get('content-type') === 'application/charx'){
            let imported:number|null
            if(res.headers.get('content-type') === 'application/zip' || res.headers.get('content-type') === 'application/charx'){
                //A Blob-backed File has a known size and is read from the blob store, not held as one JS array.
                imported = await importCharacterProcess({
                    name: 'realm.charx',
                    data: new File([await res.blob()], 'realm.charx', {type: res.headers.get('content-type')}),
                })
            }
            else{
                //A Blob-backed File has a known size and is read from the blob store, not held as one JS array.
                imported = await importCharacterProcess({
                    name: 'realm.png',
                    data: new File([await res.blob()], 'realm.png', {type: res.headers.get('content-type')}),
                })
            }
            //A file that was declined, refused or failed has shown its own message and leaves the library as it was.
            if(typeof imported !== 'number'){
                return
            }
            checkCharOrder()
            const db = getDatabase()
            if(db.characters[db.characters.length-1] && (db.goCharacterOnImport || arg.forceRedirect)){
                const index = db.characters.length-1
                changeChar(index)
            }
            return
        }
    
        const result = await res.json()
        const data:CharacterCardV3 = result.card
        const img:string = result.img

        data.data.extensions.risuRealmImportId = id
    
        const added = await importCharacterCardSpec(data, await getHubResources(img), 'hub')
        if(added === null){
            alertError(language.errors.noData)
            return
        }
        if(!added){
            return
        }
        checkCharOrder()
        let db = getDatabase()
        if(db.characters[db.characters.length-1] && (db.goCharacterOnImport || arg.forceRedirect)){
            const index = db.characters.length-1
            changeChar(index)
            alertStore.set({
                type: 'none',
                msg: ''
            })
        }
    } catch (error) {
        console.error(error)
        console.log(error.stack)
        alertError(language.errors.importFailed)
    }
}

export async function getHubResources(id:string) {
    const res = await fetch(`${hubURL}/resource/${id}`)
    if(res.status !== 200){
        throw (await res.text())
    }
    return Buffer.from(await (res).arrayBuffer())
}

export function isCharacterHasAssets(char:character|groupChat){
    if(char.type === 'group'){
        return false
    }

    if(char.additionalAssets && char.additionalAssets.length > 0){
        return true
    }

    if(char.emotionImages && char.emotionImages.length > 0){
        return true
    }

    if(char.ccAssets && char.ccAssets.length > 0){
        return true
    }

    return false
}


type CharacterCardV2Risu = {
    spec: 'chara_card_v2'
    spec_version: '2.0' // May 8th addition
    data: {
        name: string
        description: string
        personality: string
        scenario: string
        first_mes: string
        mes_example: string
        creator_notes: string
        system_prompt: string
        post_history_instructions: string
        alternate_greetings: string[]
        character_book?: CharacterBook
        tags: string[]
        creator: string
        character_version: string
        extensions: {
            risuai?:{
                emotions?:[string, string][]
                bias?:[string, number][],
                viewScreen?: any,
                customScripts?:customscript[]
                utilityBot?: boolean,
                sdData?:[string,string][],
                additionalAssets?:[string,string,string][],
                backgroundHTML?:string,
                license?:string,
                triggerscript?:triggerscript[]
                private?:boolean
                additionalText?:string
                virtualscript?:string
                largePortrait?:boolean
                lorePlus?:boolean
                inlayViewScreen?:boolean
                newGenData?: {
                    prompt: string,
                    negative: string,
                    instructions: string,
                    emotionInstructions: string,
                },
                vits?: {[key:string]:string}
            }
            depth_prompt?: { depth: number, prompt: string }
        }
    }
}  


interface OldTavernChar{
    avatar: "none"
    chat: string
    create_date: string
    description: string
    first_mes: string
    mes_example: string
    name: string
    personality: string
    scenario: string
    talkativeness: "0.5"
    spec_version?: '1.0'
}
type CharacterBook = {
    name?: string
    description?: string
    scan_depth?: number // agnai: "Memory: Chat History Depth"
    token_budget?: number // agnai: "Memory: Context Limit"
    recursive_scanning?: boolean // no agnai equivalent. whether entry content can trigger other entries
    extensions: Record<string, any>
    entries: Array<charBookEntry>
  }

interface charBookEntry{
    keys: Array<string>
    content: string
    extensions: Record<string, any>
    enabled: boolean
    insertion_order: number // if two entries inserted, lower "insertion order" = inserted higher

    // FIELDS WITH NO CURRENT EQUIVALENT IN SILLY
    name?: string // not used in prompt engineering
    priority?: number // if token budget reached, lower priority value = discarded first

    // FIELDS WITH NO CURRENT EQUIVALENT IN AGNAI
    id?: number // not used in prompt engineering
    comment?: string // not used in prompt engineering
    selective?: boolean // if `true`, require a key from both `keys` and `secondary_keys` to trigger the entry
    secondary_keys?: Array<string> // see field `selective`. ignored if selective == false
    constant?: boolean // if true, always inserted in the prompt (within budget limit)
    position?: 'before_char' | 'after_char' // whether the entry is placed before or after the character defs
    case_sensitive?:boolean
    use_regex?:boolean
    mode?: string // Risuai mode field
    folder?: string // Risuai folder field
}

interface RccCardMetaData{
    usePassword?: boolean
}
