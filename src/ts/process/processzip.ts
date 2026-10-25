import { AppendableBuffer, pieceStoreOrNull, saveAsset, saveAssetFromPieces, type LocalWriter, type VirtualWriter } from "../globalApi.svelte";
import * as fflate from "fflate";
import { asBuffer, Semaphore, sleep } from "../util";
import { alertStore } from "../alert";
import { language } from "src/lang";
import { fillLang } from "src/lang/fill";
import { storeAssetLimitBytes } from "../storage/assetLimit";
import { isImportSource, type ImportSource } from "../importSource";

const MIB = 1024 * 1024;
const CHUNK_SIZE_BYTES = MIB; // 1MB

/**
 * Size bounds of a CharX import, in bytes. An entry larger than its bound refuses the whole card.
 * Mutable only so that tests can use small fixtures.
 */
export const charxLimits = {
    // card.json and module.risum
    metadataBytes: 50 * MIB,
    // every other entry
    assetBytes: 1024 * MIB,
    // decoded assets queued or being saved beyond which reading the archive pauses
    backlogBytes: 32 * MIB,
    // received bytes of an asset entry past which it is saved in pieces instead of being collected whole (a store that writes in pieces)
    streamAfterBytes: 4 * MIB,
};

/**
 * One streamed entry's decoded bytes on their way from fflate's synchronous `ondata` to the asynchronous piece
 * consumer of `saveAssetFromPieces`. Queued bytes are reported to the importer's backlog and released as the consumer
 * takes them. The queue ends in one of two ways: `end()` after the entry's last chunk, so the consumer finishes
 * normally; or `fail(error)`, after which the consumer's next read throws, so a save of a cut-short entry aborts and
 * never takes a valid key. `dispose()` is the consumer being done (finished or failed): whatever is still queued is
 * released and later pushes are dropped.
 */
export class PieceQueue implements AsyncIterable<Uint8Array> {
    #chunks: Uint8Array[] = []
    #queuedBytes = 0
    #ended = false
    #closed = false
    #failure: Error | undefined
    #wake: (() => void) | undefined

    constructor(private readonly onQueued: (bytes: number) => void, private readonly onReleased: (bytes: number) => void) {}

    /** Queues a copy of `data`; dropped once the queue is closed, failed or ended. */
    push(data: Uint8Array) {
        if (this.#closed || this.#ended || this.#failure || data.byteLength === 0) {
            return
        }
        this.#chunks.push(data.slice())
        this.#queuedBytes += data.byteLength
        this.onQueued(data.byteLength)
        this.#wakeConsumer()
    }

    /** No more chunks follow: the consumer drains what is queued and then finishes. */
    end() {
        this.#ended = true
        this.#wakeConsumer()
    }

    /** The entry cannot be completed: queued bytes are released and the consumer's next read throws `error`. */
    fail(error: Error) {
        if (this.#failure || this.#closed) {
            return
        }
        this.#failure = error
        this.#release()
        this.#wakeConsumer()
    }

    /** The consumer is done: queued bytes are released and later pushes are dropped. */
    dispose() {
        this.#closed = true
        this.#release()
        this.#wakeConsumer()
    }

    #release() {
        const bytes = this.#queuedBytes
        this.#chunks = []
        this.#queuedBytes = 0
        if (bytes > 0) {
            this.onReleased(bytes)
        }
    }

    #wakeConsumer() {
        const wake = this.#wake
        this.#wake = undefined
        wake?.()
    }

    [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
        return {
            next: async () => {
                for (;;) {
                    if (this.#failure) {
                        throw this.#failure
                    }
                    const chunk = this.#chunks.shift()
                    if (chunk) {
                        this.#queuedBytes -= chunk.byteLength
                        this.onReleased(chunk.byteLength)
                        return { done: false, value: chunk }
                    }
                    if (this.#ended || this.#closed) {
                        return { done: true, value: undefined }
                    }
                    await new Promise<void>(resolve => { this.#wake = resolve })
                }
            },
            return: async () => {
                this.dispose()
                return { done: true, value: undefined }
            },
        }
    }
}

/**
 * The largest asset an import takes: the asset limit, and never more than the page's selected store accepts for one
 * asset (`storeAssetLimitBytes`). An asset above it can never be saved there and is refused before anything is saved
 * instead of failing in the middle of the import.
 */
export function assetByteLimit(): number {
    return Math.min(charxLimits.assetBytes, storeAssetLimitBytes());
}

function entryLimit(name: string): number {
    return name === 'card.json' || name === 'module.risum' ? charxLimits.metadataBytes : assetByteLimit();
}

// An entry that is saved as an asset (not card.json, module.risum or other JSON).
function isStreamableAsset(name: string): boolean {
    return name !== 'card.json' && name !== 'module.risum' && !isIgnoredJson(name)
}

// JSON other than card.json is not used by the import.
function isIgnoredJson(name: string): boolean {
    return name.endsWith('.json') && name !== 'card.json';
}

// The upper bound of a central directory that is read ahead of the import.
const MAX_DIRECTORY_BYTES = 16 * MIB;

// Queue management constants
const MAX_CONCURRENT_ASSET_SAVES = 10;

export async function processZip(dataArray: Uint8Array): Promise<string> {
    const unzipped = await new Promise<fflate.Unzipped>((resolve, reject) => {
        fflate.unzip(dataArray, (err, data) => {
            if (err) reject(err);
            else resolve(data);
        });
    });

    const imageFile = Object.keys(unzipped).find(fileName => /\.(jpg|jpeg|png)$/i.test(fileName));
    if (imageFile) {
        const imageData = unzipped[imageFile];
        const blob = new Blob([asBuffer(imageData)], { type: 'image/png' });
        const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const result = reader.result as string;
                resolve(result);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
        return base64;
    } else {
        throw new Error(language.errors.noImageInZip);
    }
}

export class CharXWriter{
    zip:fflate.Zip
    writeEnd:boolean = false
    apb = new AppendableBuffer()
    #takenFilenames:Set<string> = new Set()
    constructor(private writer:LocalWriter|WritableStreamDefaultWriter<Uint8Array>|VirtualWriter){
        const handlerAsync = (err:Error, dat:Uint8Array, final:boolean) => {
            if(dat){
                this.apb.append(dat)
            }
            if(final){
                this.writeEnd = true
            }
        }

        this.zip = new fflate.Zip()
        this.zip.ondata = handlerAsync
    }
    async init(){
        //do nothing, just to make compatible with other writer
    }

    async writeJpeg(img: Uint8Array){
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        if(!ctx){
            return
        }
        const imgBlob = new Blob([asBuffer(img)], {type: 'image/jpeg'})
        const imgURL = URL.createObjectURL(imgBlob)
        const imgElement = document.createElement('img')
        imgElement.src = imgURL
        await imgElement.decode()
        canvas.width = imgElement.width
        canvas.height = imgElement.height
        ctx.drawImage(imgElement, 0, 0)
        const blob = await (new Promise((res:BlobCallback, rej) => {
            canvas.toBlob(res, 'image/jpeg')
        }))
        const buf = await blob.arrayBuffer()
        this.apb.append(new Uint8Array(buf))
    }

    async write(key:string,data:Uint8Array|string, level?:0|1|2|3|4|5|6|7|8|9){
        key = this.#sanitizeZipFilename(key)
        let dat:Uint8Array
        if(typeof data === 'string'){
            dat = new TextEncoder().encode(data)
        }
        else{
            dat = data
        }
        this.writeEnd = false
        const file = new fflate.ZipDeflate(key, {
            level: level ?? 0
        });
        this.zip.add(file)
        file.push(dat, true)
        await this.writer.write(this.apb.buffer)
        this.apb.clear()
        if(this.writeEnd){
            await this.writer.close()
        }
        
    }

    #sanitizeZipFilename(filename:string) {
        let sanitized = filename.replace(/[<>:"\\|?*\x00-\x1F]/g, '_');
        sanitized = sanitized.replace(/[. ]+$/, '');
        const reservedNames = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
        if (reservedNames.test(sanitized)) {
            sanitized = '_' + sanitized;
        }
        if (!sanitized || sanitized === '.' || sanitized === '..') {
            sanitized = 'file_' + Date.now();
        }

        const splitName = sanitized.split('.');
        let baseName = splitName.slice(0, -1).join('.');
        const extension = splitName.length > 1 ? '.' + splitName[splitName.length - 1] : '';
        let counter = 1;
        let uniqueName = baseName + extension;
        while (this.#takenFilenames.has(uniqueName)) {
            uniqueName = `${baseName}_${counter}${extension}`;
            counter++;
        }
        
        this.#takenFilenames.add(uniqueName);
        return uniqueName;
    }

    async end(){
        this.zip.end()
        await this.writer.write(this.apb.buffer)
        this.apb.clear()
        if(this.writeEnd){
            await this.writer.close()
        }
    }
}

/**
 * Where a failed CharX parse came from:
 * - 'input': reading the File, Blob or stream failed.
 * - 'importer': the importer's own handlers threw (for example an allocation failure while buffering an entry).
 * - 'zip': the ZIP library reported the archive as unreadable.
 * - 'size': an entry is larger than its limit in `charxLimits`; `entryName` and `limitBytes` say which and how large.
 */
export type CharXFailureOrigin = 'input' | 'importer' | 'zip' | 'size'

/** What a 'size' failure names: the entry (its path inside the archive) and the limit it passed. */
export type CharXSizeDetail = { entryName: string, limitBytes: number }

/**
 * The single error `CharXImporter.parse()` and `hasZipEndRecord()` reject with. Callers decide the message from
 * `origin` alone (and, for 'size', from `entryName` and `limitBytes`) and never from the underlying error's code,
 * name, message or class.
 */
export class CharXParseError extends Error {
    readonly origin: CharXFailureOrigin
    readonly cause: unknown
    readonly entryName?: string
    readonly limitBytes?: number

    constructor(origin: CharXFailureOrigin, cause: unknown, size?: CharXSizeDetail) {
        super(cause instanceof Error ? cause.message : String(cause))
        this.name = 'CharXParseError'
        this.origin = origin
        this.cause = cause
        this.entryName = size?.entryName
        this.limitBytes = size?.limitBytes
        if (cause instanceof Error && cause.stack) {
            this.stack = cause.stack
        }
    }
}

const ZIP_END_RECORD_SIZE = 22
const ZIP_MAX_COMMENT_SIZE = 0xFFFF

/**
 * Tells whether the end of a ZIP archive holds an end-of-central-directory record: the signature `PK\x05\x06` with
 * the 22-byte record and the comment length it declares both inside the data. The central directory offset is not
 * checked, because the offsets of an archive written after a JPEG are relative to the archive, not to the file.
 *
 * Rejects with a `CharXParseError` of origin 'input' when the tail cannot be read.
 */
export async function hasZipEndRecord(data: Uint8Array | File | ImportSource): Promise<boolean> {
    const { tail } = await readZipTail(data)
    return findEndRecord(tail) >= 0
}

/** The last bytes of the input that can hold an end record, and where they start in the input. */
async function readZipTail(data: Uint8Array | File | ImportSource): Promise<{ tail: Uint8Array, start: number }> {
    try {
        const size = data instanceof File || isImportSource(data) ? data.size : data.byteLength
        const start = Math.max(0, size - (ZIP_END_RECORD_SIZE + ZIP_MAX_COMMENT_SIZE))
        const tail = isImportSource(data)
            ? await data.read(start, size)
            : data instanceof File
                ? new Uint8Array(await data.slice(start).arrayBuffer())
                : data.subarray(start)
        return { tail, start }
    } catch (error) {
        throw new CharXParseError('input', error)
    }
}

/** The index of the last end record whose declared comment fits inside `tail`, or -1. */
function findEndRecord(tail: Uint8Array): number {
    for (let i = tail.byteLength - ZIP_END_RECORD_SIZE; i >= 0; i--) {
        if (tail[i] === 0x50 && tail[i + 1] === 0x4B && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) {
            const commentLength = tail[i + 20] | (tail[i + 21] << 8)
            if (i + ZIP_END_RECORD_SIZE + commentLength <= tail.byteLength) {
                return i
            }
        }
    }
    return -1
}

const ZIP_CENTRAL_RECORD_SIZE = 46

/**
 * The entries a ZIP central directory lists, with the uncompressed size each declares.
 *
 * The directory is located as the bytes just before the end record, with the length the end record gives; the offset
 * field never locates it (it is only read as a zip64 sentinel), because it is relative to the archive and an
 * archive written after a JPEG has a prefix.
 * Returns null, and the caller falls back to checking sizes while streaming, whenever the directory cannot be trusted:
 * zip64 fields or a zip64 locator, a multi-disk archive, a directory larger than MAX_DIRECTORY_BYTES, or one that does
 * not parse into exactly the entry count of the end record and end exactly at the end record.
 *
 * Rejects with a `CharXParseError` of origin 'input' when bytes cannot be read.
 */
async function readZipDirectory(data: Uint8Array | File | ImportSource): Promise<Array<{ name: string, size: number }> | null> {
    const { tail, start } = await readZipTail(data)
    const end = findEndRecord(tail)
    if (end < 0) {
        return null
    }
    const record = new DataView(tail.buffer, tail.byteOffset + end, ZIP_END_RECORD_SIZE)
    const disk = record.getUint16(4, true)
    const directoryDisk = record.getUint16(6, true)
    const count = record.getUint16(10, true)
    const directorySize = record.getUint32(12, true)
    const hasLocator = end >= 20 && tail[end - 20] === 0x50 && tail[end - 19] === 0x4B && tail[end - 18] === 0x06 && tail[end - 17] === 0x07
    if (hasLocator || disk !== 0 || directoryDisk !== 0 || count === 0xFFFF || directorySize === 0xFFFFFFFF
        || record.getUint32(16, true) === 0xFFFFFFFF || directorySize > MAX_DIRECTORY_BYTES) {
        return null
    }
    const directoryEnd = start + end
    const directoryStart = directoryEnd - directorySize
    if (directoryStart < 0) {
        return null
    }
    let directory: Uint8Array
    try {
        directory = isImportSource(data)
            ? await data.read(directoryStart, directoryEnd)
            : data instanceof File
                ? new Uint8Array(await data.slice(directoryStart, directoryEnd).arrayBuffer())
                : data.subarray(directoryStart, directoryEnd)
    } catch (error) {
        throw new CharXParseError('input', error)
    }
    const view = new DataView(directory.buffer, directory.byteOffset, directory.byteLength)
    const entries: Array<{ name: string, size: number }> = []
    let at = 0
    for (let i = 0; i < count; i++) {
        if (at + ZIP_CENTRAL_RECORD_SIZE > directory.byteLength || view.getUint32(at, true) !== 0x02014b50) {
            return null
        }
        const flags = view.getUint16(at + 8, true)
        const size = view.getUint32(at + 24, true)
        const nameLength = view.getUint16(at + 28, true)
        const extraLength = view.getUint16(at + 30, true)
        const commentLength = view.getUint16(at + 32, true)
        const next = at + ZIP_CENTRAL_RECORD_SIZE + nameLength + extraLength + commentLength
        if (size === 0xFFFFFFFF || next > directory.byteLength) {
            return null
        }
        // fflate reads an entry name as UTF-8 only when the flag is set, and as Latin-1 otherwise
        entries.push({ name: fflate.strFromU8(directory.subarray(at + ZIP_CENTRAL_RECORD_SIZE, at + ZIP_CENTRAL_RECORD_SIZE + nameLength), !(flags & 2048)), size })
        at = next
    }
    return at === directory.byteLength ? entries : null
}

/**
 * Per-entry byte store of the importer. Chunks are copied as they arrive and joined once, into an array of exactly the
 * decoded length, when the entry is complete, so an entry costs about twice its size at the join and the chunks are
 * released right after it. An entry that is not kept (`retain` false) is only counted.
 */
export class EntryBuffer {
    #chunks: Uint8Array[] = []
    #received = 0

    constructor(private readonly retain: boolean) {}

    /** Bytes received, whether or not they are kept. */
    get byteLength(): number {
        return this.#received
    }

    /** Bytes held in memory. */
    get retainedBytes(): number {
        return this.retain ? this.#received : 0
    }

    append(data: Uint8Array) {
        this.#received += data.byteLength
        if (this.retain && data.byteLength > 0) {
            this.#chunks.push(data.slice())
        }
    }

    /** The kept bytes as one array. The buffer is empty afterwards. */
    take(): Uint8Array {
        const chunks = this.#chunks
        this.#chunks = []
        if (chunks.length === 1) {
            return chunks[0]
        }
        const out = new Uint8Array(chunks.reduce((n, chunk) => n + chunk.byteLength, 0))
        let at = 0
        for (const chunk of chunks) {
            out.set(chunk, at)
            at += chunk.byteLength
        }
        return out
    }
}

/**
 * Streaming importer for CharX (character export) files.
 *
 * CharX files are ZIP archives containing:
 * - card.json: Character card data (CCv3 format)
 * - module.risum: Optional module data (scripts, lorebook)
 * - assets/*: Image and other asset files
 *
 * This class reads and imports character data by:
 * - Processing ZIP streams incrementally to handle large files efficiently
 * - Parsing metadata (card.json, module.risum) synchronously
 * - Saving assets to storage concurrently (limited to prevent memory exhaustion)
 */
export class CharXImporter{
    // ZIP streaming parser
    unzip:fflate.Unzip

    // Asset save semaphore
    private semaphore: Semaphore

    // Completion tracking
    private totalEnqueued: number = 0
    private totalCompleted: number = 0
    private isFinalized: boolean = false
    private completionResolver?: () => void
    private completionRejecter?: (error: Error) => void
    private completionPromise?: Promise<void>
    private completionSettled: boolean = false
    private errors: Error[] = []
    private onProgress?: (done: number, total: number) => void

    // The first parse failure. Once set, no entry is started, no data is handled, no save is queued or started,
    // and no progress is shown; parse() rejects with it.
    #failure: CharXParseError|undefined

    // Set by abandon(): the importer's owner has finished with it, so no save that has not started is started and no
    // progress is shown.
    #abandoned: boolean = false

    // Whether the store writes in pieces, asked once per parse(); when it does, an asset entry past
    // charxLimits.streamAfterBytes is saved from a PieceQueue instead of being collected whole.
    #streamPieces: boolean = false
    // Entries still receiving data into a queue, by entry name.
    #receiving: Map<string, PieceQueue> = new Map()
    // Queues whose save has not ended, so a failure or abandon() reaches the writer that consumes them.
    #saving: Set<PieceQueue> = new Set()

    // Results: filename -> saved asset ID mapping
    assets:{[key:string]:string} = {}

    // Bytes of decoded assets that are queued or being saved. Reading the archive pauses while this is above
    // charxLimits.backlogBytes, so the backlog does not grow with the number of assets.
    #pendingBytes: number = 0
    #wakeReader: (() => void)|undefined

    // Temporary buffers for accumulating file chunks during streaming
    assetBuffers:{[key:string]:EntryBuffer} = {}

    // Extracted character card JSON content
    cardData:string|undefined

    // Extracted module binary data
    moduleData:Uint8Array|undefined

    // Configuration
    alertInfo:boolean = false  // Show progress alerts to user

    constructor(){
        this.unzip = new fflate.Unzip()
        this.unzip.register(fflate.UnzipInflate)
        this.unzip.onfile = (file) => this.#handleFile(file)

        this.semaphore = new Semaphore(MAX_CONCURRENT_ASSET_SAVES)
        this.onProgress = (done, total) => {
            if(this.alertInfo && !this.#failure && !this.#abandoned){
                alertStore.set({
                    type: 'wait',
                    msg: fillLang(language.alerts.savingAssets, { done: String(done), total: String(total) })
                })
            }
        }
    }

    /**
     * High-level method to parse ZIP data from various sources.
     *
     * Handles four input types:
     * - ReadableStream: Streams data chunks as they arrive
     * - Uint8Array: Automatically converted to stream
     * - File: Uses built-in stream() method
     * - ImportSource: Uses its stream() method; its directory is read by range like a File's
     *
     * parse() rejects with a CharXParseError whose origin says where the first failure came from. Nothing is
     * started, queued or shown after that failure, and the completion promise is never settled.
     *
     * An entry larger than its limit in `charxLimits` fails the parse with origin 'size'. When the central directory
     * of a Uint8Array or File can be read, that is decided before any entry is read, so nothing has been saved.
     * Otherwise (a stream, or a directory that cannot be trusted) it is decided while the entry streams in, so assets
     * of earlier entries may already have been saved.
     *
     * After parse() completes:
     * - cardData and moduleData are immediately available
     * - Asset saving continues in the background
     * - MUST call done() to wait for all assets to finish saving
     *
     * Usage:
     * ```
     * await importer.parse(data)
     * const card = importer.cardData  // Available immediately
     * await importer.done()           // Wait for assets
     * await saveCharacter(card, importer.assets)
     * ```
     */
    async parse(data:Uint8Array|File|ImportSource|ReadableStream<Uint8Array>){
        // Create completion promise at the start of parsing
        this.completionPromise = this.#awaitCompletion()

        this.#failure = undefined
        try {
            this.#streamPieces = await pieceStoreOrNull() !== null
        } catch {
            this.#streamPieces = false
        }

        // An entry the central directory lists above its limit refuses the card before any entry is read
        if(!(data instanceof ReadableStream)){
            try {
                const oversize = (await readZipDirectory(data))?.find(entry => entry.size > entryLimit(entry.name))
                if(oversize){
                    this.#recordSize(oversize.name)
                }
            } catch (error) {
                this.#failure = error instanceof CharXParseError ? error : new CharXParseError('input', error)
            }
            if(this.#failure){
                throw this.#failure
            }
        }

        // Convert all input types to ReadableStream for uniform processing
        let reader:ReadableStreamDefaultReader<Uint8Array>
        try {
            reader = this.#toStream(data).getReader()
        } catch (error) {
            this.#record('input', error)
            throw this.#failure
        }

        while(!this.#failure){
            await this.#waitForBacklog()
            if(this.#failure){
                break
            }
            let chunk:ReadableStreamReadResult<Uint8Array>
            try {
                chunk = await reader.read()
            } catch (error) {
                this.#record('input', error)
                break
            }
            if(chunk.value){
                this.#feedChunk(chunk.value, false)
            }
            if(this.#failure){
                break
            }
            if(chunk.done){
                this.#feedChunk(new Uint8Array(0), true)
                break
            }
        }

        // The failure is thrown before #finalize(), so the completion promise is never rejected without a listener.
        if(this.#failure){
            reader.cancel().catch(() => {})
            throw this.#failure
        }
        // An entry still receiving when the archive ends was cut short: its save fails, so it is never stored under a key.
        this.#failQueues(this.#receiving.values(), new Error('The archive ended before an entry was complete'))
        this.#receiving.clear()
        await this.#finalize()
    }

    #failQueues(queues: Iterable<PieceQueue>, error: Error) {
        for (const queue of [...queues]) {
            queue.fail(error)
        }
    }

    /**
     * Records a failure unless one is already recorded: the first failure wins, whatever its origin.
     * Entries still buffered are released.
     */
    #record(origin:CharXFailureOrigin, cause:unknown, size?:CharXSizeDetail) {
        if(this.#failure){
            return
        }
        this.#failure = new CharXParseError(origin, cause, size)
        this.assetBuffers = {}
        // Every queue ends by throwing, so no writer finishes an entry that was cut short.
        this.#failQueues(this.#saving, this.#failure)
        this.#receiving.clear()
    }

    /** Records that the entry `entryName` is larger than its limit. */
    #recordSize(entryName:string) {
        const limitBytes = entryLimit(entryName)
        this.#record('size', new Error(`${entryName} is larger than ${limitBytes} bytes`), { entryName, limitBytes })
    }

    /** Resolves once the decoded assets waiting to be saved are at most charxLimits.backlogBytes, or a failure is recorded. */
    async #waitForBacklog() {
        // Woken by #releaseBacklog on every drain, including the release of a failed save's queued bytes.
        while(!this.#failure && this.#pendingBytes > charxLimits.backlogBytes){
            await new Promise<void>(resolve => { this.#wakeReader = resolve })
        }
    }

    /**
     * Feeds a chunk of ZIP data to the streaming parser.
     * A throw from the parser is a ZIP failure; the importer's own handlers never throw out of it.
     */
    #feedChunk(data:Uint8Array, final:boolean){
        try {
            this.unzip.push(data, final)
        } catch (error) {
            this.#record('zip', error)
        }
    }

    /**
     * Returns a promise that resolves when all assets have been processed.
     * Must be called after parse() has been invoked.
     */
    async done(){
        if (!this.completionPromise) {
            throw new Error('parse() must be called before done()')
        }
        return this.completionPromise
    }

    /**
     * Ends the importer's use without waiting for its saves: a save that has not started never starts, no progress is
     * shown from now on, and a rejection of the completion promise that nobody awaits is not reported as unhandled.
     * Whole-entry saves already in flight run to their end, but a save that streams an entry in pieces is aborted: its
     * queue ends by throwing, the writer discards its temporary file and nothing is stored under the entry's key.
     * Call it when the import stops after parse() succeeded without a call to done() having returned; it is harmless
     * after done() has settled.
     */
    abandon(){
        this.#abandoned = true
        this.#failQueues(this.#saving, new Error('The import was abandoned'))
        this.completionPromise?.catch(() => {})
    }

    #awaitCompletion(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.completionResolver = resolve
            this.completionRejecter = reject
            this.completionSettled = false
            this.errors = []
            this.#checkCompletion()
        })
    }

    #checkCompletion(): void {
        if (!this.completionSettled && this.isFinalized && this.totalCompleted >= this.totalEnqueued) {
            this.completionSettled = true
            if (this.errors.length > 0) {
                const error = this.errors.length === 1
                    ? this.errors[0]
                    : new AggregateError(this.errors, fillLang(language.errors.moduleAssetsSaveFailed, { count: String(this.errors.length) }))
                this.completionRejecter?.(error)
                return
            }
            this.completionResolver?.()
        }
    }

    /**
     * Converts various data types to ReadableStream for uniform processing.
     */
    #toStream(data: Uint8Array|File|ImportSource|ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
        // Already a stream - return as-is
        if(data instanceof ReadableStream){
            return data
        }

        // An import source streams itself, reading in bounded pieces
        if(isImportSource(data)){
            return data.stream()
        }

        // File has built-in stream() method
        if(data instanceof File){
            return data.stream()
        }

        // Convert Uint8Array to stream, chunked to prevent blocking
        let offset = 0
        return new ReadableStream({
            pull(controller) {
                if (offset >= data.byteLength) {
                    controller.close()
                    return
                }
                const end = Math.min(offset + CHUNK_SIZE_BYTES, data.byteLength)
                controller.enqueue(data.subarray(offset, end))
                offset = end
            }
        })
    }

    /**
     * Called when a new file is discovered in the ZIP archive.
     * Sets up streaming handlers and starts processing if file size is acceptable.
     */
    #handleFile(file: fflate.UnzipFile) {
        if(this.#failure){
            return
        }
        const assetIndex = file.name
        // An entry the local header declares above its limit is refused here. An entry is always started or the parse
        // ends, because the ZIP library keeps the compressed bytes of an entry that was never started.
        if((file.originalSize ?? 0) > entryLimit(assetIndex)){
            this.#recordSize(assetIndex)
            return
        }
        try {
            // JSON other than card.json is not used, so its bytes are counted against the limit and not kept
            this.assetBuffers[assetIndex] = new EntryBuffer(!isIgnoredJson(assetIndex))

            file.ondata = (err, dat, final) => this.#handleFileData(assetIndex, err, dat, final)
        } catch (error) {
            this.#record('importer', error)
            return
        }

        file.start()
    }

    /**
     * Called for each chunk of file data as it streams in.
     * Accumulates chunks into buffer until file is complete. An entry never holds more than its limit: the chunk
     * that would pass it fails the parse before it is appended.
     * An error argument is the ZIP library's; an exception raised here is the importer's own and is caught here,
     * so it never travels back through the library as if it were a ZIP failure.
     */
    #handleFileData(fileName: string, err: fflate.FlateError|null, data: Uint8Array, final: boolean) {
        if(this.#failure){
            return
        }
        if(err){
            this.#record('zip', err)
            return
        }
        try {
            const buffer = this.assetBuffers[fileName]
            if(buffer.byteLength + data.byteLength > entryLimit(fileName)){
                this.#recordSize(fileName)
                return
            }
            buffer.append(data)
            // The decision uses the bytes received so far: a local header's size is zero or absent in an archive
            // written with data descriptors, so it says nothing about the entry's real size.
            const queue = this.#receiving.get(fileName)
            if(queue){
                queue.push(data)
            }
            else if(this.#streamPieces && isStreamableAsset(fileName) && buffer.byteLength > charxLimits.streamAfterBytes){
                this.#switchToPieces(fileName, buffer)
            }
            if(final){
                this.#handleFileComplete(fileName)
            }
        } catch (error) {
            this.#record('importer', error)
        }
    }

    /**
     * Called when a file has been completely read from the ZIP.
     * Routes files to appropriate handlers based on filename/extension.
     */
    #handleFileComplete(fileName: string) {
        if(this.#failure){
            return
        }
        const buffer = this.assetBuffers[fileName]
        delete this.assetBuffers[fileName]

        const queue = this.#receiving.get(fileName)
        if(queue){
            // The entry is complete: the consumer drains what is queued and finishes the save.
            this.#receiving.delete(fileName)
            queue.end()
        }
        else if(isIgnoredJson(fileName)){
            // Other JSON files are not used
        }
        else if(fileName === 'card.json'){
            this.cardData = new TextDecoder().decode(buffer.take())
        }
        else if(fileName === 'module.risum'){
            this.moduleData = buffer.take()
        }
        else{
            // All other files are treated as assets (images, etc.)
            this.#processAssetQueue({
                id: fileName,
                data: buffer.take()
            })
        }
    }

    /** Takes `bytes` off the backlog and wakes the reader if it is waiting on it. */
    #releaseBacklog(bytes: number) {
        this.#pendingBytes -= bytes
        const wake = this.#wakeReader
        this.#wakeReader = undefined
        wake?.()
    }

    /**
     * Moves an entry that has passed charxLimits.streamAfterBytes from the whole path to the piece path: what it
     * holds goes into a new queue, `saveAssetFromPieces` consumes the queue, and the entry's later chunks are pushed
     * to it as they arrive. The entry is counted as enqueued here, in the same synchronous turn as the switch, so
     * done() cannot settle before its save is accounted for.
     */
    #switchToPieces(fileName: string, buffer: EntryBuffer) {
        const held = buffer.take()
        const queue = new PieceQueue(bytes => { this.#pendingBytes += bytes }, bytes => this.#releaseBacklog(bytes))
        // The entry's size is still counted against its limit, without keeping its bytes.
        const counter = new EntryBuffer(false)
        counter.append(held)
        this.assetBuffers[fileName] = counter
        this.#receiving.set(fileName, queue)
        this.#saving.add(queue)
        this.totalEnqueued += 1
        queue.push(held)
        void this.#saveStreamed(fileName, queue)
    }

    async #saveStreamed(fileName: string, queue: PieceQueue) {
        let acquired = false
        try {
            await this.semaphore.acquire()
            acquired = true
            if(this.#failure || this.#abandoned){
                return
            }
            // No file name: the key is the one `saveAsset` gives the same bytes.
            this.assets[fileName] = await saveAssetFromPieces(queue, { sizeBound: entryLimit(fileName) })
        } catch (error) {
            this.errors.push(error instanceof Error ? error : new Error(String(error)))
        } finally {
            if (acquired) {
                this.semaphore.release()
            }
            // Releases whatever is still queued, which wakes a reader waiting on the backlog.
            queue.dispose()
            this.#saving.delete(queue)
            this.totalCompleted += 1
            this.onProgress?.(this.totalCompleted, this.totalEnqueued)
            this.#checkCompletion()
        }
    }

    /**
     * Queues an asset for saving with concurrency control.
     */
    async #processAssetQueue(asset:{id:string, data:Uint8Array}){
        this.totalEnqueued += 1
        const byteLength = asset.data.byteLength
        this.#pendingBytes += byteLength
        let acquired = false
        try {
            await this.semaphore.acquire()
            acquired = true
            if(this.#failure || this.#abandoned){
                return
            }
            this.assets[asset.id] = await saveAsset(asset.data)
        } catch (error) {
            this.errors.push(error instanceof Error ? error : new Error(String(error)))
        } finally {
            if (acquired) {
                this.semaphore.release()
            }
            this.#releaseBacklog(byteLength)
            this.totalCompleted += 1
            this.onProgress?.(this.totalCompleted, this.totalEnqueued)
            this.#checkCompletion()
        }
    }

    /**
     * Finalizes processing when all ZIP data has been pushed.
     * Marks the queue as complete.
     */
    async #finalize(){
        this.isFinalized = true
        this.#checkCompletion()
    }
}
