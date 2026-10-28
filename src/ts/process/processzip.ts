import { pieceStoreOrNull, saveAsset, saveAssetFromPieces, type LocalWriter, type VirtualWriter } from "../globalApi.svelte";
import * as fflate from "fflate";
import crc32 from "crc/crc32";
import { asBuffer, Semaphore, sleep } from "../util";
import { alertStore } from "../alert";
import { language } from "src/lang";
import { fillLang } from "src/lang/fill";
import { storeAssetLimitBytes } from "../storage/assetLimit";
import { importSourceOfBytes, importSourceOfFile, isImportSource, WindowedReader, type ImportSource } from "../importSource";
import { IMAGE_TYPE_HEAD_BYTES, IMAGE_TYPE_TAIL_BYTES, imageTypeOfEnds } from "../media/imageType";

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

/**
 * What the importer does with an entry: `card` keeps it as the card JSON, `module` keeps it as the module bytes, `asset`
 * saves it, `text` keeps its bytes in `CharXImporter.texts`, `drop` reads it to its end and keeps nothing.
 */
export type EntryKind = 'card' | 'module' | 'asset' | 'text' | 'drop'

/**
 * A route is the kind of an entry together with the largest size the entry may have. `Infinity` is legal only for
 * `drop`: the limit is compared with `>`, so it never refuses.
 */
export type EntryRoute = { kind: EntryKind, limitBytes: number }
export type EntryRouter = (name: string) => EntryRoute

// JSON other than card.json is not used by the CharX import.
function isIgnoredJson(name: string): boolean {
    return name.endsWith('.json') && name !== 'card.json';
}

// The CharX routing. Limits are read on every call because they are mutable.
const defaultRoute: EntryRouter = (name) => {
    if(name === 'card.json'){
        return { kind: 'card', limitBytes: charxLimits.metadataBytes }
    }
    if(name === 'module.risum'){
        return { kind: 'module', limitBytes: charxLimits.metadataBytes }
    }
    return { kind: isIgnoredJson(name) ? 'drop' : 'asset', limitBytes: assetByteLimit() }
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

/** The ZIP64 sentinel: an archive offset or an entry size that reaches it cannot be recorded in a plain zip. */
export const ZIP_SIZE_SENTINEL = 0xFFFFFFFF

/** The archive being written would need ZIP64: an offset or an entry size reached the writer's limit. */
export class CharxTooLargeError extends Error {
    constructor(public readonly limit:number){
        super(`The CharX file would reach ${limit} bytes, which is more than a CharX file can hold here`)
        this.name = 'CharxTooLargeError'
    }
}

/** The archive would hold more entries than a plain zip's end record can count (the 65,536th entry). */
export class CharxTooManyEntriesError extends Error {
    constructor(public readonly limit:number){
        super(`A CharX file cannot hold more than ${limit} entries`)
        this.name = 'CharxTooManyEntriesError'
    }
}

/** An entry name is longer than a plain zip header can record. */
export class CharxNameTooLongError extends Error {
    constructor(public readonly nameBytes:number, public readonly limit:number){
        super(`A CharX entry name of ${nameBytes} bytes is longer than the ${limit} bytes a zip header can record`)
        this.name = 'CharxNameTooLongError'
    }
}

/**
 * A streamed asset did not stay what the export first measured: it changed size or content between the two passes, or
 * could not be read to its end. The export stops; `assetName` is the name the person knows it by (never the store key).
 */
export class ExportAssetChangedError extends Error {
    constructor(public readonly assetName:string, options?:{ cause?:unknown }){
        super(`The asset ${assetName} changed or could not be read while it was being exported`, options)
        this.name = 'ExportAssetChangedError'
    }
}

/** The most entries a plain zip's end record can count. */
export const ZIP_MAX_ENTRIES = 0xFFFF

/** The longest entry name, in UTF-8 bytes, that a plain zip header can record. */
export const ZIP_MAX_NAME_BYTES = 0xFFFF

export type CharxZipLevel = 0|1|2|3|4|5|6|7|8|9

function joinBytes(parts:ReadonlyArray<Uint8Array>):Uint8Array {
    let length = 0
    for(const part of parts){
        length += part.length
    }
    const out = new Uint8Array(length)
    let at = 0
    for(const part of parts){
        out.set(part, at)
        at += part.length
    }
    return out
}

/**
 * The compression and checksum steps of a CharX entry, as mutable hooks so that a test can make either throw. `deflate`
 * is fflate's streaming `Deflate` with one final push, whose body is byte-identical to the `ZipDeflate` body (the
 * synchronous `deflateSync` differs for large inputs). `crc32` is the unsigned CRC-32 of the bytes.
 */
export const charxCodec = {
    deflate(data:Uint8Array, level:CharxZipLevel):Uint8Array {
        const parts:Uint8Array[] = []
        const deflater = new fflate.Deflate({ level }, (part) => { parts.push(part) })
        deflater.push(data, true)
        return joinBytes(parts)
    },
    /**
     * `previous` is the CRC-32 of the bytes before `data` when folding, and `undefined` for the first piece. The `crc`
     * package starts from an all-zero state when it is given 0, but the state that follows a checksum of 0 is the one
     * a fresh start has, so a 0 is passed on as no previous value.
     */
    crc32(data:Uint8Array, previous?:number):number {
        return crc32(Buffer.from(data.buffer, data.byteOffset, data.byteLength), previous === 0 ? undefined : previous)
    },
}

/**
 * The canvas work of a `charxJpeg` export as one mutable hook: the card portrait re-encoded as JPEG bytes. Resolves to
 * `null` when the page has no 2D canvas context (the archive is then written with no JPEG in front).
 */
export const charxEncode = {
    async jpeg(img:Uint8Array):Promise<Uint8Array|null> {
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        if(!ctx){
            return null
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
        return new Uint8Array(buf)
    },
}

const ZIP_LOCAL_HEADER_BYTES = 30
const ZIP_CENTRAL_RECORD_BYTES = 46
const ZIP_END_RECORD_BYTES = 22
const ZIP_DESCRIPTOR_BYTES = 16
const ZIP_VERSION = 20
const ZIP_METHOD_DEFLATE = 8
const ZIP_METHOD_STORE = 0
const ZIP_FLAG_DESCRIPTOR = 0x08
const ZIP_FLAG_UTF8_HIGH = 0x08

/**
 * The deflate-option bits of the general-purpose flag, as fflate sets them per level (`dbf` of fflate 0.8.3): 0x04 at
 * level 0, and so on. They sit in bits 1-2 of the low flag byte.
 */
function deflateOptionBits(level:number):number {
    return level === 1 ? 3 : level < 6 ? 2 : level === 9 ? 1 : 0
}

/**
 * The DOS date and time of an entry as fflate packs them (`wzh` of fflate 0.8.3): local time, two-second resolution,
 * the year from 1980 to 2099.
 */
function dosTimestamp(ms:number):number {
    const date = new Date(ms)
    const year = date.getFullYear() - 1980
    if(year < 0 || year > 119){
        throw new RangeError('The clock is outside the 1980 to 2099 years that a zip entry can record')
    }
    return ((year << 25) | ((date.getMonth() + 1) << 21) | (date.getDate() << 16) | (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) >>> 0
}

/** What the central directory needs of one written entry; the CRC and sizes are those of the entry's central record. */
interface CharxEntryRecord {
    name:Uint8Array
    // low and high byte of the general-purpose flag of the central record
    flagLow:number
    flagHigh:number
    // ZIP_METHOD_DEFLATE for an entry of `write`, ZIP_METHOD_STORE for a streamed asset
    method:number
    // one timestamp per entry, used by both its local header and its central record
    stamp:number
    crc:number
    compressedSize:number
    size:number
    // zip-relative offset of the local header
    offset:number
    // the local header says "sizes follow" and a data descriptor follows the body (a zero-length entry only)
    descriptor:boolean
}

/** One piece of a streamed asset, with the size of the whole asset as of that read. */
export interface CharxStreamPiece {
    bytes:Uint8Array
    total:number
}

/**
 * One read of a streamed asset. `rest` is closed by the writer. `identity` is what the store said about the file at
 * this read (equal on both reads of an unchanged file); `undefined` where the store says nothing.
 */
export interface CharxStreamOpened {
    first:CharxStreamPiece
    rest:AsyncGenerator<CharxStreamPiece, void, undefined>
    identity?:string
}

/** `check` is the first pass over an asset (size, checksum, type), `stream` the second (the bytes are written). */
export type CharxStreamPhase = 'check' | 'stream'

/** Bytes read (`check`) or written (`stream`) so far, and the asset's size. */
export type CharxStreamProgress = (phase:CharxStreamPhase, doneBytes:number, totalBytes:number) => void

/**
 * The size of every write a streamed asset's bytes reach the file writer in (the last may be smaller). The same number
 * as `TAURI_WRITE_CHUNK_BYTES` of `exportWriters.ts`, which is not imported here; a test keeps the two equal.
 */
export const CHARX_STREAM_HAND_ON_BYTES = 4 * MIB

/** The least time between two progress reports of one phase of a streamed asset (its first and last always report). */
export const CHARX_STREAM_PROGRESS_INTERVAL_MS = 250

/**
 * Writes a CharX (zip) archive. Every entry is framed without a data descriptor: its local header carries the CRC-32 and
 * both sizes, so a streaming reader that ends an entry at the first zip signature inside its data (fflate's `Unzip`,
 * which the fork and upstream importers use) never cuts a binary asset short. The one exception is a zero-length entry,
 * which is written as fflate writes it (flag bit 3, zeros in the local header, a descriptor) because upstream's start
 * check never starts a descriptor-free empty entry.
 */
export class CharXWriter{
    writeEnd:boolean = false
    #takenFilenames:Set<string> = new Set()
    #entries:CharxEntryRecord[] = []
    // Archive offset: the zip bytes handed to the writer. A `charxJpeg` prefix is not part of the zip's offsets, so it
    // never advances this count.
    #zipOffset:number = 0
    // The JPEG written in front of the zip; it goes out with the next hand-on.
    #prefix:Uint8Array|undefined
    #ended:boolean = false
    // The error that stopped the export; every later call throws it before anything else is written.
    #latch:{ error:unknown }|undefined
    // Settles when the call running last has finished; the next call starts after it, so calls never overlap.
    #queue:Promise<void> = Promise.resolve()
    /**
     * `limit` is the strict backstop: a chunk that would make an archive offset or an entry's size reach it is never
     * handed on. The default is the ZIP64 sentinel; a test passes a small one.
     */
    constructor(private writer:LocalWriter|WritableStreamDefaultWriter<Uint8Array>|VirtualWriter, private readonly limit:number = ZIP_SIZE_SENTINEL){
    }
    async init(){
        //do nothing, just to make compatible with other writer
    }

    async writeJpeg(img: Uint8Array){
        await this.#run(async () => {
            const jpeg = await charxEncode.jpeg(img)
            if(jpeg){
                this.#prefix = this.#prefix ? joinBytes([this.#prefix, jpeg]) : jpeg
            }
        })
    }

    /**
     * Runs one step after every earlier step has finished: an entry records its offset before the awaited hand-on that
     * advances the offset, so two overlapping steps would record the same offset. An error a step throws is latched,
     * and every later step throws the same error without running.
     */
    async #run<T>(step:() => Promise<T>):Promise<T> {
        const earlier = this.#queue
        let finished!:() => void
        this.#queue = new Promise<void>((resolve) => { finished = resolve })
        await earlier
        try{
            if(this.#latch){
                throw this.#latch.error
            }
            try{
                return await step()
            }
            catch(error){
                this.#latch = { error }
                throw error
            }
        }
        finally{
            finished()
        }
    }

    /**
     * Hands the given zip bytes (with a pending JPEG in front) to the writer as one fresh array. Bytes that would make
     * the archive offset reach the limit are not handed on.
     */
    async #flush(parts:ReadonlyArray<Uint8Array>){
        let zipBytes = 0
        for(const part of parts){
            zipBytes += part.length
        }
        if(this.#zipOffset + zipBytes >= this.limit){
            throw new CharxTooLargeError(this.limit)
        }
        const prefix = this.#prefix
        const out = joinBytes(prefix ? [prefix, ...parts] : parts)
        await this.writer.write(out)
        this.#prefix = undefined
        this.#zipOffset += zipBytes
    }

    /**
     * Hands exactly `bytes` to the writer: no copy and no JPEG in front (a streamed asset's header, which goes through
     * `#flush`, has already taken it). The same backstop as `#flush`. The array is the caller's and is never written into
     * afterwards.
     */
    async #flushExact(bytes:Uint8Array){
        if(this.#zipOffset + bytes.length >= this.limit){
            throw new CharxTooLargeError(this.limit)
        }
        await this.writer.write(bytes)
        this.#zipOffset += bytes.length
    }

    async write(key:string,data:Uint8Array|string, level?:CharxZipLevel){
        await this.#run(() => this.#writeEntry(key, data, level))
    }

    async #writeEntry(key:string,data:Uint8Array|string, level?:CharxZipLevel){
        if(this.#ended){
            throw new Error('The CharX archive is already finished')
        }
        const entryName = this.#sanitizeZipFilename(key)
        const name = new TextEncoder().encode(entryName)
        if(name.length > ZIP_MAX_NAME_BYTES){
            throw new CharxNameTooLongError(name.length, ZIP_MAX_NAME_BYTES)
        }
        if(this.#entries.length >= ZIP_MAX_ENTRIES){
            throw new CharxTooManyEntriesError(ZIP_MAX_ENTRIES)
        }
        let dat:Uint8Array
        if(typeof data === 'string'){
            dat = new TextEncoder().encode(data)
        }
        else{
            dat = data
        }
        if(dat.length >= this.limit){
            throw new CharxTooLargeError(this.limit)
        }
        const zipLevel = level ?? 0
        const body = charxCodec.deflate(dat, zipLevel)
        const empty = dat.length === 0
        const record:CharxEntryRecord = {
            name,
            flagLow: (deflateOptionBits(zipLevel) << 1) | (empty ? ZIP_FLAG_DESCRIPTOR : 0),
            // UTF-8 flag exactly when the UTF-8 byte length differs from the string length, as fflate sets it
            flagHigh: name.length !== entryName.length ? ZIP_FLAG_UTF8_HIGH : 0,
            method: ZIP_METHOD_DEFLATE,
            stamp: dosTimestamp(Date.now()),
            crc: empty ? 0 : charxCodec.crc32(dat),
            compressedSize: body.length,
            size: dat.length,
            offset: this.#zipOffset,
            descriptor: empty,
        }
        // The header and the body go out in one hand-on, which `#flush` checks first: a size or an offset that reaches
        // the limit also makes the hand-on reach it.
        const parts = [this.#localHeader(record), body]
        if(empty){
            parts.push(this.#descriptor(record))
        }
        await this.#flush(parts)
        this.#entries.push(record)
    }

    /**
     * Writes one large asset as a STORE entry without holding it: two passes over `open()`, which reads the asset from its
     * start each time and whose `rest` this method closes.
     *
     * - Pass 1 (`check`) folds the CRC-32 and counts the bytes, keeps the ends the image type is read from, and checks
     *   the asset is `expectedTotal` bytes long. If `options.metaPath` is given, the type-only `x_meta` entry is written
     *   next, before the asset's own entry (the order of the small-asset path).
     * - Pass 2 (`stream`) reads again, requires the same size and file identity, writes the local header (method 0, the
     *   CRC and both sizes from pass 1, no data descriptor) and then the bytes in hand-ons of exactly
     *   `CHARX_STREAM_HAND_ON_BYTES` (the last may be smaller). Each hand-on is a view of one piece the source
     *   yielded or a new array joining the end of the last piece with the next bytes; no array is reused or written into
     *   after it is handed on, and the source must not write into an array it yielded. A byte past `expectedTotal` is never
     *   handed on. When the asset's size is not a multiple of the hand-on size, the last hand-on waits until the count
     *   and the CRC of this pass equal pass 1's; otherwise every byte may be handed on before a difference is found. A
     *   difference leaves the entry's bytes without a central directory, so the archive written so far is never complete.
     *
     * Any difference between the passes, a short or long read, or a rejection of the source's `next()` throws
     * `ExportAssetChangedError(options.name)`. An error of the source's `open()`, a writer error (including
     * `CharxTooLargeError`) and a cancel thrown by `onProgress` pass on unchanged. `onProgress` is called for the first
     * and the last piece of each phase and at most once per `CHARX_STREAM_PROGRESS_INTERVAL_MS` between them.
     */
    async writeStream(key:string, open:() => Promise<CharxStreamOpened>, expectedTotal:number, onProgress?:CharxStreamProgress, options:{ name?:string, metaPath?:string } = {}){
        await this.#run(async () => {
            if(this.#ended){
                throw new Error('The CharX archive is already finished')
            }
            const assetName = options.name ?? key
            const entryName = this.#sanitizeZipFilename(key)
            const name = new TextEncoder().encode(entryName)
            if(name.length > ZIP_MAX_NAME_BYTES){
                throw new CharxNameTooLongError(name.length, ZIP_MAX_NAME_BYTES)
            }
            if(this.#entries.length + (options.metaPath === undefined ? 1 : 2) > ZIP_MAX_ENTRIES){
                throw new CharxTooManyEntriesError(ZIP_MAX_ENTRIES)
            }
            // Before any pass: an entry that cannot fit is refused without reading it.
            if(this.#zipOffset + ZIP_LOCAL_HEADER_BYTES + name.length + expectedTotal >= this.limit){
                throw new CharxTooLargeError(this.limit)
            }
            const changed = (cause?:unknown) => new ExportAssetChangedError(assetName, cause === undefined ? undefined : { cause })
            const report = this.#progressReporter(onProgress)

            // Pass 1
            let crc:number|undefined
            let counted = 0
            let head:Uint8Array = new Uint8Array(0)
            let tail:Uint8Array = new Uint8Array(0)
            let identity:string|undefined
            await this.#readPass(open, changed, async (opened) => {
                identity = opened.identity
                if(opened.first.total !== expectedTotal){
                    throw changed()
                }
            }, async (bytes) => {
                counted += bytes.length
                if(counted > expectedTotal){
                    throw changed()
                }
                crc = charxCodec.crc32(bytes, crc)
                if(head.length < IMAGE_TYPE_HEAD_BYTES){
                    head = joinBytes([head, bytes.subarray(0, IMAGE_TYPE_HEAD_BYTES - head.length)])
                }
                if(bytes.length > 0){
                    tail = bytes.length >= IMAGE_TYPE_TAIL_BYTES ? bytes.slice(bytes.length - IMAGE_TYPE_TAIL_BYTES) : joinBytes([tail, bytes]).slice(-IMAGE_TYPE_TAIL_BYTES)
                }
                report('check', counted, expectedTotal, false)
            })
            if(counted !== expectedTotal){
                throw changed()
            }
            report('check', counted, expectedTotal, true)
            const checksum = crc ?? 0
            if(options.metaPath !== undefined){
                await this.#writeEntry(options.metaPath, JSON.stringify({ type: imageTypeOfEnds(head, tail) }), 6)
            }

            // Pass 2
            const record:CharxEntryRecord = {
                name,
                flagLow: 0,
                flagHigh: name.length !== entryName.length ? ZIP_FLAG_UTF8_HIGH : 0,
                method: ZIP_METHOD_STORE,
                stamp: dosTimestamp(Date.now()),
                crc: checksum,
                compressedSize: expectedTotal,
                size: expectedTotal,
                offset: this.#zipOffset,
                descriptor: false,
            }
            const held:Uint8Array[] = []
            let heldBytes = 0
            let written = 0
            let passCrc:number|undefined
            const handOn = async (bytes:Uint8Array) => {
                await this.#flushExact(bytes)
            }
            await this.#readPass(open, changed, async (opened) => {
                if(opened.identity !== identity || opened.first.total !== expectedTotal){
                    throw changed()
                }
                const header = this.#localHeader(record)
                // The header, the whole body and the offset they reach are checked before the header is handed on.
                if(this.#zipOffset + header.length + expectedTotal >= this.limit){
                    throw new CharxTooLargeError(this.limit)
                }
                await this.#flush([header])
            }, async (bytes) => {
                if(written + bytes.length > expectedTotal){
                    throw changed()
                }
                written += bytes.length
                passCrc = charxCodec.crc32(bytes, passCrc)
                let at = 0
                if(heldBytes > 0){
                    const need = CHARX_STREAM_HAND_ON_BYTES - heldBytes
                    if(bytes.length < need){
                        held.push(bytes)
                        heldBytes += bytes.length
                    }
                    else{
                        const joined = joinBytes([...held, bytes.subarray(0, need)])
                        held.length = 0
                        heldBytes = 0
                        at = need
                        await handOn(joined)
                    }
                }
                if(heldBytes === 0){
                    while(bytes.length - at >= CHARX_STREAM_HAND_ON_BYTES){
                        await handOn(bytes.subarray(at, at + CHARX_STREAM_HAND_ON_BYTES))
                        at += CHARX_STREAM_HAND_ON_BYTES
                    }
                    if(at < bytes.length){
                        held.push(bytes.subarray(at))
                        heldBytes = bytes.length - at
                    }
                }
                report('stream', written, expectedTotal, false)
            })
            if(written !== expectedTotal || (passCrc ?? 0) !== checksum){
                throw changed()
            }
            if(heldBytes > 0){
                await handOn(held.length === 1 ? held[0] : joinBytes(held))
            }
            report('stream', written, expectedTotal, true)
            this.#entries.push(record)
        })
    }

    /**
     * One read of a streamed asset: opens it, lets `begin` look at the first read, then gives `take` every piece in order
     * (the first included) and closes the generator whatever happens. A rejection of the generator's `next()` becomes
     * `ExportAssetChangedError` (the cause goes to the console). An error of `begin` or `take` (a writer error, a cancel
     * thrown by the progress callback) is not the generator's and passes on unchanged.
     */
    async #readPass(
        open:() => Promise<CharxStreamOpened>,
        changed:(cause?:unknown) => ExportAssetChangedError,
        begin:(opened:CharxStreamOpened) => Promise<void>,
        take:(bytes:Uint8Array) => Promise<void>,
    ){
        let rest:AsyncGenerator<CharxStreamPiece, void, undefined>|undefined
        try{
            const opened = await open()
            rest = opened.rest
            await begin(opened)
            await take(opened.first.bytes)
            for(;;){
                let next:IteratorResult<CharxStreamPiece, void>
                try{
                    next = await rest.next()
                }
                catch(error){
                    console.error(error)
                    throw changed(error)
                }
                if(next.done === true){
                    break
                }
                await take(next.value.bytes)
            }
        }
        finally{
            await rest?.return(undefined).catch(() => { })
        }
    }

    /**
     * The throttled form of `onProgress`: the first report of each phase goes out at once, the others at most once per
     * interval by `performance.now()`, and the report marked `last` always does (unless the same count has just gone out).
     */
    #progressReporter(onProgress:CharxStreamProgress|undefined){
        const reported = new Map<CharxStreamPhase, { at:number, done:number }>()
        return (phase:CharxStreamPhase, done:number, total:number, last:boolean) => {
            if(!onProgress){
                return
            }
            const now = performance.now()
            const before = reported.get(phase)
            const due = before === undefined || now - before.at >= CHARX_STREAM_PROGRESS_INTERVAL_MS
            if(last ? before?.done !== done : due){
                reported.set(phase, { at: now, done })
                onProgress(phase, done, total)
            }
        }
    }

    #localHeader(record:CharxEntryRecord):Uint8Array {
        const header = new Uint8Array(ZIP_LOCAL_HEADER_BYTES + record.name.length)
        const view = new DataView(header.buffer)
        view.setUint32(0, 0x04034B50, true)
        view.setUint16(4, ZIP_VERSION, true)
        header[6] = record.flagLow
        header[7] = record.flagHigh
        view.setUint16(8, record.method, true)
        view.setUint32(10, record.stamp, true)
        if(!record.descriptor){
            view.setUint32(14, record.crc, true)
            view.setUint32(18, record.compressedSize, true)
            view.setUint32(22, record.size, true)
        }
        view.setUint16(26, record.name.length, true)
        header.set(record.name, ZIP_LOCAL_HEADER_BYTES)
        return header
    }

    #descriptor(record:CharxEntryRecord):Uint8Array {
        const descriptor = new Uint8Array(ZIP_DESCRIPTOR_BYTES)
        const view = new DataView(descriptor.buffer)
        view.setUint32(0, 0x08074B50, true)
        view.setUint32(4, record.crc, true)
        view.setUint32(8, record.compressedSize, true)
        view.setUint32(12, record.size, true)
        return descriptor
    }

    /** The central directory and the end record, as one fresh array. */
    #centralDirectory():Uint8Array {
        let directoryBytes = 0
        for(const record of this.#entries){
            directoryBytes += ZIP_CENTRAL_RECORD_BYTES + record.name.length
        }
        const out = new Uint8Array(directoryBytes + ZIP_END_RECORD_BYTES)
        const view = new DataView(out.buffer)
        let at = 0
        for(const record of this.#entries){
            view.setUint32(at, 0x02014B50, true)
            // version made by 20, host system 0 (MS-DOS)
            out[at + 4] = ZIP_VERSION
            out[at + 5] = 0
            view.setUint16(at + 6, ZIP_VERSION, true)
            out[at + 8] = record.flagLow
            out[at + 9] = record.flagHigh
            view.setUint16(at + 10, record.method, true)
            view.setUint32(at + 12, record.stamp, true)
            view.setUint32(at + 16, record.crc, true)
            view.setUint32(at + 20, record.compressedSize, true)
            view.setUint32(at + 24, record.size, true)
            view.setUint16(at + 28, record.name.length, true)
            // extra field, comment, disk number, internal and external attributes: all zero
            view.setUint32(at + 42, record.offset, true)
            out.set(record.name, at + ZIP_CENTRAL_RECORD_BYTES)
            at += ZIP_CENTRAL_RECORD_BYTES + record.name.length
        }
        view.setUint32(at, 0x06054B50, true)
        view.setUint16(at + 8, this.#entries.length, true)
        view.setUint16(at + 10, this.#entries.length, true)
        view.setUint32(at + 12, directoryBytes, true)
        view.setUint32(at + 16, this.#zipOffset, true)
        return out
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
        await this.#run(async () => {
            if(this.#ended){
                throw new Error('The CharX archive is already finished')
            }
            const directory = this.#centralDirectory()
            this.#ended = true
            this.writeEnd = true
            await this.#flush([directory])
            await this.writer.close()
        })
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

/** One entry of a central directory: what the record declares, and where its local header starts relative to the archive. */
type ZipDirectoryEntry = {
    name: string
    nameBytes: Uint8Array
    size: number
    compressedSize: number
    crc: number
    method: number
    flags: number
    localOffset: number
    /** The length of the central record's own extra field; the local header's may differ. */
    extraLength: number
}

/** The entries of a central directory, and where the archive and its directory start in the input. */
type ZipDirectory = {
    entries: ZipDirectoryEntry[]
    /** Where the archive starts: the input is longer than the archive when a JPEG precedes it. */
    zipStart: number
    directoryStart: number
}

/**
 * The entries a ZIP central directory lists, with what each declares, and where the archive starts.
 *
 * The directory is located as the bytes just before the end record, with the length the end record gives. The offset
 * field gives the archive's start (`zipStart`): it is relative to the archive, and an archive written after a JPEG has
 * a prefix.
 * Returns null, and the caller falls back to checking sizes while streaming, whenever the directory cannot be trusted:
 * zip64 fields or a zip64 locator, a multi-disk archive, a directory larger than MAX_DIRECTORY_BYTES, an entry whose
 * sizes or offset reach the zip64 sentinel, an offset field that puts the archive before the input, or a directory
 * that does not parse into exactly the entry count of the end record and end exactly at the end record.
 *
 * Rejects with a `CharXParseError` of origin 'input' when bytes cannot be read.
 */
async function readZipDirectory(data: Uint8Array | File | ImportSource): Promise<ZipDirectory | null> {
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
    const zipStart = directoryStart - record.getUint32(16, true)
    if (zipStart < 0) {
        return null
    }
    const view = new DataView(directory.buffer, directory.byteOffset, directory.byteLength)
    const entries: ZipDirectoryEntry[] = []
    let at = 0
    for (let i = 0; i < count; i++) {
        if (at + ZIP_CENTRAL_RECORD_SIZE > directory.byteLength || view.getUint32(at, true) !== 0x02014b50) {
            return null
        }
        const flags = view.getUint16(at + 8, true)
        const method = view.getUint16(at + 10, true)
        const crc = view.getUint32(at + 16, true)
        const compressedSize = view.getUint32(at + 20, true)
        const size = view.getUint32(at + 24, true)
        const nameLength = view.getUint16(at + 28, true)
        const extraLength = view.getUint16(at + 30, true)
        const commentLength = view.getUint16(at + 32, true)
        const localOffset = view.getUint32(at + 42, true)
        const next = at + ZIP_CENTRAL_RECORD_SIZE + nameLength + extraLength + commentLength
        if (size === ZIP_SIZE_SENTINEL || compressedSize === ZIP_SIZE_SENTINEL || localOffset === ZIP_SIZE_SENTINEL || next > directory.byteLength) {
            return null
        }
        const nameBytes = directory.subarray(at + ZIP_CENTRAL_RECORD_SIZE, at + ZIP_CENTRAL_RECORD_SIZE + nameLength)
        // fflate reads an entry name as UTF-8 only when the flag is set, and as Latin-1 otherwise
        entries.push({ name: fflate.strFromU8(nameBytes, !(flags & 2048)), nameBytes, size, compressedSize, crc, method, flags, localOffset, extraLength })
        at = next
    }
    return at === directory.byteLength ? { entries, zipStart, directoryStart } : null
}

const ZIP_LOCAL_HEADER_SIZE = 30
const ZIP_DESCRIPTOR_SIZE = 16
/** Bytes read past a local header's expected end, so a local extra field a little longer than the central one needs no second read. */
const ZIP_HEADER_READ_SLACK = 64

/** An entry of the plan: the bytes the splice drops, replaces or passes on, as absolute positions in the input. */
type PlannedEntry = {
    /** Where the local header starts. */
    start: number
    /** The local header as the file holds it: the splice compares the source's bytes with it. */
    header: Uint8Array
    /** The header the importer's ZIP reader gets: bit 3 cleared, the central CRC and sizes written in. */
    rewrittenHeader: Uint8Array
    bodyStart: number
    bodyEnd: number
}

/** How the importer reads an archive through its central directory: the entries in file order, and where the directory starts. */
type DirectoryReadPlan = {
    entries: PlannedEntry[]
    directoryStart: number
    /** The input's full size, through the end record. */
    inputSize: number
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.byteLength !== b.byteLength) {
        return false
    }
    for (let i = 0; i < a.byteLength; i++) {
        if (a[i] !== b[i]) {
            return false
        }
    }
    return true
}

/**
 * The length of the data descriptor at the start of `bytes` when it states the entry's central CRC and sizes: 16 with
 * the signature, 12 without, tried in that order; 0 when it states anything else or `bytes` is too short.
 */
function descriptorLength(bytes: Uint8Array, entry: ZipDirectoryEntry): number {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (bytes.byteLength >= ZIP_DESCRIPTOR_SIZE && view.getUint32(0, true) === 0x08074b50
        && view.getUint32(4, true) === entry.crc && view.getUint32(8, true) === entry.compressedSize && view.getUint32(12, true) === entry.size) {
        return ZIP_DESCRIPTOR_SIZE
    }
    if (bytes.byteLength >= ZIP_DESCRIPTOR_SIZE - 4 && view.getUint32(0, true) === entry.crc
        && view.getUint32(4, true) === entry.compressedSize && view.getUint32(8, true) === entry.size) {
        return ZIP_DESCRIPTOR_SIZE - 4
    }
    return 0
}

/** A view of the input as a source: a source as it is, a `File` and bytes through the adapters of `importSource.ts`. */
function importSourceOfInput(data: Uint8Array | File | ImportSource): ImportSource {
    return isImportSource(data) ? data : data instanceof File ? importSourceOfFile(data) : importSourceOfBytes('charx', data)
}

function inputSizeOf(data: Uint8Array | File | ImportSource): number {
    return data instanceof File || isImportSource(data) ? data.size : data.byteLength
}

/**
 * Checks the archive against its central directory and plans reading it by the directory. Returns null, and the file is
 * read as it is without the plan, whenever the local headers or data descriptors disagree with the directory (an
 * offset, a name, a method, bit 3, a CRC or a size) or two entries overlap. Bytes outside every listed entry (a JPEG
 * prefix, gaps, entries the directory does not list) are not part of the plan.
 *
 * Reads only headers and descriptors, one read per boundary: entry i-1's descriptor and entry i's header together,
 * through a `WindowedReader`, so packed small entries share a window and a big body is skipped without being read.
 *
 * Rejects with a `CharXParseError` of origin 'input' when bytes cannot be read.
 */
async function planDirectoryRead(data: Uint8Array | File | ImportSource, directory: ZipDirectory): Promise<DirectoryReadPlan | null> {
    if (directory.entries.length === 0) {
        return null
    }
    const inputSize = inputSizeOf(data)
    const reader = new WindowedReader(importSourceOfInput(data), inputSize)
    const sorted = [...directory.entries].sort((a, b) => a.localOffset - b.localOffset)
    const planned: PlannedEntry[] = []
    // The entry whose data descriptor is the next thing to read, and where it starts.
    let pending: { entry: ZipDirectoryEntry, at: number } | null = null
    // Where the previous entry ends, when it has no descriptor to read.
    let previousEnd = directory.zipStart
    try {
        for (const entry of sorted) {
            const start = directory.zipStart + entry.localOffset
            const wanted = ZIP_LOCAL_HEADER_SIZE + entry.nameBytes.byteLength + entry.extraLength + ZIP_HEADER_READ_SLACK
            let bytes: Uint8Array
            if (pending) {
                if (start < pending.at) {
                    return null
                }
                // A descriptor and the header after it are one read when nothing but a gap shorter than a descriptor lies between them.
                const together = start >= pending.at && start - pending.at <= ZIP_DESCRIPTOR_SIZE
                const first = await reader.read(pending.at, together ? start + wanted : pending.at + ZIP_DESCRIPTOR_SIZE)
                const length = descriptorLength(first, pending.entry)
                if (length === 0 || pending.at + length > start) {
                    return null
                }
                bytes = together ? first.subarray(start - pending.at) : await reader.read(start, start + wanted)
                pending = null
            } else {
                if (previousEnd > start) {
                    return null
                }
                bytes = await reader.read(start, start + wanted)
            }
            if (bytes.byteLength < ZIP_LOCAL_HEADER_SIZE) {
                return null
            }
            let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
            const headerLength = ZIP_LOCAL_HEADER_SIZE + view.getUint16(26, true) + view.getUint16(28, true)
            if (bytes.byteLength < headerLength) {
                bytes = await reader.read(start, start + headerLength)
                if (bytes.byteLength < headerLength) {
                    return null
                }
                view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
            }
            const nameLength = view.getUint16(26, true)
            const flags = view.getUint16(6, true)
            if (view.getUint32(0, true) !== 0x04034b50
                || nameLength !== entry.nameBytes.byteLength
                || !bytesEqual(bytes.subarray(ZIP_LOCAL_HEADER_SIZE, ZIP_LOCAL_HEADER_SIZE + nameLength), entry.nameBytes)
                || view.getUint16(8, true) !== entry.method
                || (flags & 8) !== (entry.flags & 8)) {
                return null
            }
            const hasDescriptor = (flags & 8) !== 0
            if (!hasDescriptor && (view.getUint32(14, true) !== entry.crc || view.getUint32(18, true) !== entry.compressedSize || view.getUint32(22, true) !== entry.size)) {
                return null
            }
            // The header is copied out: the reader and the bytes of a source give views that the next read replaces.
            const header = new Uint8Array(bytes.subarray(0, headerLength))
            const rewrittenHeader = new Uint8Array(header)
            const rewrittenView = new DataView(rewrittenHeader.buffer)
            rewrittenView.setUint16(6, flags & ~8, true)
            rewrittenView.setUint32(14, entry.crc, true)
            rewrittenView.setUint32(18, entry.compressedSize, true)
            rewrittenView.setUint32(22, entry.size, true)
            const bodyStart = start + headerLength
            const bodyEnd = bodyStart + entry.compressedSize
            planned.push({ start, header, rewrittenHeader, bodyStart, bodyEnd })
            if (hasDescriptor) {
                pending = { entry, at: bodyEnd }
            } else {
                previousEnd = bodyEnd
            }
        }
        if (pending) {
            const length = descriptorLength(await reader.read(pending.at, pending.at + ZIP_DESCRIPTOR_SIZE), pending.entry)
            if (length === 0) {
                return null
            }
            previousEnd = pending.at + length
        }
    } catch (error) {
        throw new CharXParseError('input', error)
    }
    return previousEnd <= directory.directoryStart ? { entries: planned, directoryStart: directory.directoryStart, inputSize } : null
}

/**
 * The bytes of an archive read by its plan, as a sequence of chunks for the ZIP reader. Anything outside the entries of
 * the plan is dropped; a header is replaced by its rewritten form; a body passes through as views of the source's
 * chunks; the data from the central directory on passes through, so the last header always has bytes after it.
 * `push` gives the parts of one chunk, in order; `#spliceStream` joins them into one chunk for the ZIP reader.
 *
 * Throws `DirectorySpliceError` when a header differs from the one validation read.
 */
class DirectorySplice {
    #next = 0
    /** The absolute position of the next byte the source gives. */
    #position = 0
    #headerParts: Uint8Array[] = []
    #headerHave = 0

    constructor(private readonly plan: DirectoryReadPlan) {}

    /** The source ended: whether it reached the input's full size. */
    get complete(): boolean {
        return this.#position >= this.plan.inputSize
    }

    push(chunk: Uint8Array): Uint8Array[] {
        const out: Uint8Array[] = []
        const base = this.#position
        let at = 0
        while (at < chunk.byteLength) {
            const entry = this.plan.entries[this.#next]
            if (!entry) {
                const from = Math.max(at, this.plan.directoryStart - base)
                if (from < chunk.byteLength) {
                    out.push(chunk.subarray(from))
                }
                break
            }
            const absolute = base + at
            if (absolute < entry.start) {
                at = Math.min(chunk.byteLength, entry.start - base)
            } else if (absolute < entry.bodyStart) {
                const to = Math.min(chunk.byteLength, entry.bodyStart - base)
                const part = chunk.subarray(at, to)
                at = to
                const whole = this.#headerHave === 0 && part.byteLength === entry.header.byteLength
                if (!whole) {
                    this.#headerParts.push(new Uint8Array(part))
                    this.#headerHave += part.byteLength
                }
                if (base + at === entry.bodyStart) {
                    const seen = whole ? part : this.#joinedHeader()
                    if (!bytesEqual(seen, entry.header)) {
                        throw new DirectorySpliceError('A local header changed after the archive was checked')
                    }
                    out.push(entry.rewrittenHeader)
                }
            } else if (absolute < entry.bodyEnd) {
                const to = Math.min(chunk.byteLength, entry.bodyEnd - base)
                out.push(chunk.subarray(at, to))
                at = to
            } else {
                this.#next++
            }
        }
        this.#position += chunk.byteLength
        return out
    }

    #joinedHeader(): Uint8Array {
        const joined = new Uint8Array(this.#headerHave)
        let at = 0
        for (const part of this.#headerParts) {
            joined.set(part, at)
            at += part.byteLength
        }
        this.#headerParts = []
        this.#headerHave = 0
        return joined
    }
}

/** A local header differs from the one validation read: the file changed between the two reads. */
class DirectorySpliceError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'DirectorySpliceError'
    }
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

    // Bytes of the entries routed as `text`, by entry name (the last copy of a name wins)
    texts:{[key:string]:Uint8Array} = {}

    // Per entry name, the largest of the sizes any copy of the name declared in its local header (0 when it declares none)
    // and the decoded length any copy reached. These are the quantities the size checks of a later pass over the same
    // bytes compare, so a caller can refuse an oversize entry before that pass saves anything. The central directory's
    // size is not recorded: the later pass refuses on it before it reads any chunk.
    sizes:{[key:string]:number} = {}

    // Configuration
    alertInfo:boolean = false  // Show progress alerts to user

    readonly #route: EntryRouter

    constructor(route: EntryRouter = defaultRoute){
        this.#route = route
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
     * A Uint8Array, File or ImportSource whose central directory agrees with every local header and data descriptor is
     * read by that directory (`planDirectoryRead`, `DirectorySplice`), so an entry whose data holds a ZIP signature is
     * not cut short. Any other archive, and a ReadableStream, is read as it comes.
     *
     * parse() rejects with a CharXParseError whose origin says where the first failure came from. Nothing is
     * started, queued or shown after that failure, and the completion promise is never settled.
     *
     * An entry larger than the limit its route gives fails the parse with origin 'size'. When the central directory
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
        let plan:DirectoryReadPlan|null = null
        if(!(data instanceof ReadableStream)){
            try {
                const directory = await readZipDirectory(data)
                const oversize = directory?.entries.find(entry => entry.size > this.#route(entry.name).limitBytes)
                if(oversize){
                    this.#recordSize(oversize.name)
                }
                else if(directory){
                    plan = await planDirectoryRead(data, directory)
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
            const source = this.#toStream(data)
            reader = (plan ? this.#spliceStream(source, plan) : source).getReader()
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
        const limitBytes = this.#route(entryName).limitBytes
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
     * The archive read by its plan (see `DirectorySplice`): the ZIP reader gets every entry with its sizes in the header
     * and no data descriptor, so it counts an entry's bytes and never scans them for a signature. The source's own
     * read failure passes on unchanged. A header that changed since validation, or a source that ends before the
     * input's full size, is a ZIP failure, recorded here because the caller would record the stream's error as 'input'.
     * It queues nothing ahead of the importer (highWaterMark 0), so the source is read no further ahead than without the splice.
     */
    #spliceStream(source: ReadableStream<Uint8Array>, plan: DirectoryReadPlan): ReadableStream<Uint8Array> {
        const inner = source.getReader()
        const splice = new DirectorySplice(plan)
        return new ReadableStream<Uint8Array>({
            pull: async (controller) => {
                for(;;){
                    let chunk:ReadableStreamReadResult<Uint8Array>
                    try {
                        chunk = await inner.read()
                    } catch (error) {
                        controller.error(error)
                        return
                    }
                    let out:Uint8Array[]
                    try {
                        if(chunk.done){
                            if(!splice.complete){
                                throw new DirectorySpliceError('The archive ended before the end of its central directory')
                            }
                            controller.close()
                            return
                        }
                        out = splice.push(chunk.value)
                    } catch (error) {
                        this.#record('zip', error)
                        controller.error(error)
                        inner.cancel().catch(() => {})
                        return
                    }
                    if(out.length > 0){
                        // One chunk per source chunk, as an unspliced source gives it: the entries a chunk holds are
                        // started in one push, so the count of queued saves and the failure order do not depend on the splice.
                        controller.enqueue(out.length === 1 ? out[0] : joinBytes(out))
                        return
                    }
                }
            },
            cancel: (reason) => inner.cancel(reason),
        }, { highWaterMark: 0 })
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
        this.sizes[assetIndex] = Math.max(this.sizes[assetIndex] ?? 0, file.originalSize ?? 0)
        // An entry the local header declares above its limit is refused here. An entry is always started or the parse
        // ends, because the ZIP library keeps the compressed bytes of an entry that was never started.
        if((file.originalSize ?? 0) > this.#route(assetIndex).limitBytes){
            this.#recordSize(assetIndex)
            return
        }
        try {
            // An entry routed as `drop` is not used, so its bytes are counted against the limit and not kept
            this.assetBuffers[assetIndex] = new EntryBuffer(this.#route(assetIndex).kind !== 'drop')

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
            const route = this.#route(fileName)
            if(buffer.byteLength + data.byteLength > route.limitBytes){
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
            else if(this.#streamPieces && route.kind === 'asset' && buffer.byteLength > charxLimits.streamAfterBytes){
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
     * Hands the entry to the handler its route kind names: card, module, asset, text or drop.
     */
    #handleFileComplete(fileName: string) {
        if(this.#failure){
            return
        }
        const buffer = this.assetBuffers[fileName]
        delete this.assetBuffers[fileName]
        // In the piece case the counting buffer of #switchToPieces still holds the full decoded length.
        this.sizes[fileName] = Math.max(this.sizes[fileName] ?? 0, buffer.byteLength)

        const queue = this.#receiving.get(fileName)
        if(queue){
            // The entry is complete: the consumer drains what is queued and finishes the save.
            this.#receiving.delete(fileName)
            queue.end()
            return
        }
        switch(this.#route(fileName).kind){
            case 'drop':
                // Not used
                break
            case 'card':
                this.cardData = new TextDecoder().decode(buffer.take())
                break
            case 'module':
                this.moduleData = buffer.take()
                break
            case 'text':
                this.texts[fileName] = buffer.take()
                break
            case 'asset':
                // All other files are treated as assets (images, etc.)
                this.#processAssetQueue({
                    id: fileName,
                    data: buffer.take()
                })
                break
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
            this.assets[fileName] = await saveAssetFromPieces(queue, { sizeBound: this.#route(fileName).limitBytes })
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
