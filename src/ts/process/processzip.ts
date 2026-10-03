import { AppendableBuffer, saveAsset, type LocalWriter, type VirtualWriter } from "../globalApi.svelte";
import * as fflate from "fflate";
import { asBuffer, Semaphore, sleep } from "../util";
import { alertStore } from "../alert";

// File size and chunk size constants
const MAX_ASSET_SIZE_BYTES = 50 * 1024 * 1024; // 50MB
const CHUNK_SIZE_BYTES = 1024 * 1024; // 1MB

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
        throw new Error("No image found in ZIP file");
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
 */
export type CharXFailureOrigin = 'input' | 'importer' | 'zip'

/**
 * The single error `CharXImporter.parse()` and `hasZipEndRecord()` reject with. Callers decide the message from
 * `origin` alone and never from the underlying error's code, name, message or class.
 */
export class CharXParseError extends Error {
    readonly origin: CharXFailureOrigin
    readonly cause: unknown

    constructor(origin: CharXFailureOrigin, cause: unknown) {
        super(cause instanceof Error ? cause.message : String(cause))
        this.name = 'CharXParseError'
        this.origin = origin
        this.cause = cause
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
export async function hasZipEndRecord(data: Uint8Array | File): Promise<boolean> {
    let tail: Uint8Array
    try {
        const size = data instanceof File ? data.size : data.byteLength
        const start = Math.max(0, size - (ZIP_END_RECORD_SIZE + ZIP_MAX_COMMENT_SIZE))
        tail = data instanceof File
            ? new Uint8Array(await data.slice(start).arrayBuffer())
            : data.subarray(start)
    } catch (error) {
        throw new CharXParseError('input', error)
    }
    for (let i = tail.byteLength - ZIP_END_RECORD_SIZE; i >= 0; i--) {
        if (tail[i] === 0x50 && tail[i + 1] === 0x4B && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) {
            const commentLength = tail[i + 20] | (tail[i + 21] << 8)
            if (i + ZIP_END_RECORD_SIZE + commentLength <= tail.byteLength) {
                return true
            }
        }
    }
    return false
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

    // Results: filename -> saved asset ID mapping
    assets:{[key:string]:string} = {}

    // Temporary buffers for accumulating file chunks during streaming
    assetBuffers:{[key:string]:AppendableBuffer} = {}

    // Files excluded due to size limits (> MAX_ASSET_SIZE_BYTES)
    excludedFiles:string[] = []

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
            if(this.alertInfo && !this.#failure){
                alertStore.set({
                    type: 'wait',
                    msg: `Loading... (Saving Assets ${done}/${total})`
                })
            }
        }
    }

    /**
     * High-level method to parse ZIP data from various sources.
     *
     * Handles three input types:
     * - ReadableStream: Streams data chunks as they arrive
     * - Uint8Array: Automatically converted to stream
     * - File: Uses built-in stream() method
     *
     * parse() rejects with a CharXParseError whose origin says where the first failure came from. Nothing is
     * started, queued or shown after that failure, and the completion promise is never settled.
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
    async parse(data:Uint8Array|File|ReadableStream<Uint8Array>){
        // Create completion promise at the start of parsing
        this.completionPromise = this.#awaitCompletion()

        this.#failure = undefined

        // Convert all input types to ReadableStream for uniform processing
        let reader:ReadableStreamDefaultReader<Uint8Array>
        try {
            reader = this.#toStream(data).getReader()
        } catch (error) {
            this.#record('input', error)
            throw this.#failure
        }

        while(!this.#failure){
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
        await this.#finalize()
    }

    /**
     * Records a failure unless one is already recorded: the first failure wins, whatever its origin.
     * Entries still buffered are released.
     */
    #record(origin:CharXFailureOrigin, cause:unknown) {
        if(this.#failure){
            return
        }
        this.#failure = new CharXParseError(origin, cause)
        this.assetBuffers = {}
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
                    : new AggregateError(this.errors, `Failed to save ${this.errors.length} assets`)
                this.completionRejecter?.(error)
                return
            }
            this.completionResolver?.()
        }
    }

    /**
     * Converts various data types to ReadableStream for uniform processing.
     */
    #toStream(data: Uint8Array|File|ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
        // Already a stream - return as-is
        if(data instanceof ReadableStream){
            return data
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
        try {
            this.assetBuffers[assetIndex] = new AppendableBuffer()

            file.ondata = (err, dat, final) => this.#handleFileData(assetIndex, err, dat, final)
        } catch (error) {
            this.#record('importer', error)
            return
        }

        // Only process files smaller than MAX_ASSET_SIZE_BYTES (50MB)
        if((file.originalSize ?? 0) < MAX_ASSET_SIZE_BYTES){
            file.start()
        }
    }

    /**
     * Called for each chunk of file data as it streams in.
     * Accumulates chunks into buffer until file is complete.
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
            this.assetBuffers[fileName].append(data)
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
        const assetData = this.assetBuffers[fileName].buffer

        if(assetData.byteLength > MAX_ASSET_SIZE_BYTES){
            this.excludedFiles.push(fileName)
        }
        else if(fileName === 'card.json'){
            this.cardData = new TextDecoder().decode(assetData)
        }
        else if(fileName === 'module.risum'){
            this.moduleData = assetData
        }
        else if(fileName.endsWith('.json')){
            // Ignore other JSON files
        }
        else{
            // All other files are treated as assets (images, etc.)
            this.#processAssetQueue({
                id: fileName,
                data: assetData
            })
        }

        delete this.assetBuffers[fileName]
    }

    /**
     * Queues an asset for saving with concurrency control.
     */
    async #processAssetQueue(asset:{id:string, data:Uint8Array}){
        this.totalEnqueued += 1
        let acquired = false
        try {
            await this.semaphore.acquire()
            acquired = true
            if(this.#failure){
                return
            }
            this.assets[asset.id] = await saveAsset(asset.data)
        } catch (error) {
            this.errors.push(error instanceof Error ? error : new Error(String(error)))
        } finally {
            if (acquired) {
                this.semaphore.release()
            }
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
