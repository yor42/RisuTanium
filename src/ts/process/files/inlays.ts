import { v4 } from "uuid";
import { getImageType } from "src/ts/media";
import { getDatabase } from "../../storage/database.svelte";
import { getModelInfo, LLMFlags, LLMFormat } from "src/ts/model/modellist";
import { asBuffer } from "../../util";
import { getAppStore } from "../../storage/store/appStore";
import { language } from "src/lang";
import type { ByteStore } from "../../storage/store/contract";
import { isAndroidTransport, isDesktopTransport } from "../../storage/tauriByteTransport";
import { rememberWholeReadUrlOfSize } from "../../storage/assetUrlGate";
import { displayMimeOfInlay } from "../../storage/assetDisplayMime";
import {
    cacheInlayRender,
    cachedInlayRender,
    dropInlayRender,
    type InlayRender,
} from "./inlayRenderCache";
import { blobVideoWholeReadWithheld, inlayImageRenderWithheld, inlayReadVerdict, withheldStringMediaKind } from "./inlaySendGate";
import {
    decodedTextSize,
    fieldsOf,
    inFlight,
    inlayAttachmentLimit,
    inlayRecordSize,
    legacyInlayStore,
    listAppInlayKeys,
    readAppInlay,
    readAppInlayBody,
    readAppInlayRecord,
    removeAppInlay,
    summarizeAppInlay,
    withInlayLock,
    writeAppInlay,
    type InlayAsset,
    type InlayRecord,
    type InlaySummary,
} from "./inlayStore";

export type { InlayAsset, InlaySummary } from "./inlayStore";

const inlayImageExts = [
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif'
]

const inlayAudioExts = [
    'wav', 'mp3', 'ogg', 'flac'
]

const inlayVideoExts = [
    'webm', 'mp4', 'mkv'
]

export { inlayAttachmentLimit, inlayLimits } from "./inlayStore";

/** `postInlayAsset` refused a file because it is larger than `limit` bytes. */
export type InlayRefusal = {
    refused: 'too-large'
    name: string
    limit: number
}

export function isInlayRefusal(result: string | InlayRefusal | null): result is InlayRefusal {
    return result !== null && typeof result === 'object'
}

/** Bytes of one attached file handed to the store so far, and the file's size. */
export type InlayWriteProgress = { name: string, written: number, total: number }

async function writeInlay(id: string, value: InlayAsset, onProgress?: (doneBytes: number, totalBytes: number) => void) {
    try {
        await withInlayLock(id, async () => {
            await writeAppInlay(await getAppStore(), id, value, { onProgress })
        })
    } catch (error) {
        // The raw browser quota error shows an empty dialog; the copy and import flows call `writeAppInlay` directly and keep matching the raw error.
        if (isQuotaExceeded(error) || (error instanceof Error && isQuotaExceeded(error.cause))) {
            throw new Error(language.assetSaveStorageFull(value.name.includes('.') ? value.name : 'unnamed file'), { cause: error })
        }
        throw error
    }
}

function isQuotaExceeded(error: unknown): boolean {
    return error instanceof DOMException && (error.name === 'QuotaExceededError' || error.code === 22 || error.code === 1014)
}

/**
 * `onProgress` hears of an audio or video file's write: once with `written` 0 after the size check
 * passes, then as the store reports. A refused file and an image report nothing, and nothing is
 * reported after the write settles. A callback that throws never changes the write.
 */
export async function postInlayAsset(img:{
    name:string,
    data:Uint8Array|Blob
}, onProgress?: (progress: InlayWriteProgress) => void): Promise<string | InlayRefusal | null> {

    const report = (written: number, total: number) => {
        try {
            onProgress?.({ name: img.name, written, total })
        } catch {
            // A progress callback never changes the write.
        }
    }

    const extention = img.name.split('.').at(-1)
    const imgObj = new Image()
    // A Blob (a picked File) is wrapped, not copied, so an attachment never exists twice in memory.
    const partOf = (): BlobPart => img.data instanceof Blob ? img.data : asBuffer(img.data)

    if(inlayImageExts.includes(extention)){
        imgObj.src = URL.createObjectURL(new Blob([partOf()], {type: `image/${extention}`}))

        return await writeInlayImage(imgObj, {
            name: img.name,
            ext: extention
        })
    }

    const isAudio = inlayAudioExts.includes(extention)
    const isVideo = inlayVideoExts.includes(extention)
    if(isAudio || isVideo){
        const kind = isAudio ? 'audio' : 'video'
        const limit = inlayAttachmentLimit(kind)
        const size = img.data instanceof Blob ? img.data.size : img.data.byteLength
        if(size > limit){
            return { refused: 'too-large', name: img.name, limit }
        }
        const blob = new Blob([partOf()], {type: `${kind}/${extention}`})
        const imgid = v4()

        report(0, size)
        await writeInlay(imgid, {
            name: img.name,
            data: blob,
            ext: extention,
            type: kind
        }, report)

        return `${imgid}`
    }

    return null
}

export async function writeInlayImage(imgObj:HTMLImageElement, arg:{name?:string, ext?:string, id?:string} = {}) {

    let drawHeight = 0
    let drawWidth = 0
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    await new Promise((resolve) => {
        imgObj.onload = () => {
            drawHeight = imgObj.height
            drawWidth = imgObj.width

            //resize image to fit inlay, if total pixels exceed 1024*1024
            const maxPixels = 1024 * 1024
            const currentPixels = drawHeight * drawWidth

            if(currentPixels > maxPixels){
                const scaleFactor = Math.sqrt(maxPixels / currentPixels)
                drawWidth = Math.floor(drawWidth * scaleFactor)
                drawHeight = Math.floor(drawHeight * scaleFactor)
            }

            canvas.width = drawWidth
            canvas.height = drawHeight
            ctx.drawImage(imgObj, 0, 0, drawWidth, drawHeight)
            resolve(null)
        }
    })
    const imageBlob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    if(imageBlob === null){
        throw new Error('The image could not be encoded.')
    }

    const imgid = arg.id ?? v4()

    await writeInlay(imgid, {
        name: arg.name ?? imgid,
        data: imageBlob,
        ext: 'png',
        height: drawHeight,
        width: drawWidth,
        type: 'image'
    })

    return `${imgid}`
}

export type InlaySignature = {
    signatures: {
        type: 'function'|'text'
        content: string
    }[],
    sourceFormat: LLMFormat,
    source: string
}

export async function saveInlayedSignature(sigid:string,signature:InlaySignature){
    await writeInlay(sigid, {
        name: sigid,
        data: JSON.stringify(signature),
        ext: 'json',
        type: 'signature'
    } satisfies InlayAsset)
    return sigid
}


/** The Blob a base64 data URI holds, or `null` when `text` is not one. */
function base64ToBlob(text: string): Blob | null {
    const comma = text.indexOf(',')
    if(comma < 0 || !text.startsWith('data:')){
        return null
    }
    const header = text.slice(0, comma)
    if(!header.endsWith(';base64')){
        return null
    }
    let byteString: string
    try {
        byteString = atob(text.slice(comma + 1))
    } catch {
        return null
    }
    const mimeString = header.slice('data:'.length).split(';')[0]

    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
    }

    return new Blob([ab], { type: mimeString });
}

function blobToBase64(blob: Blob): Promise<string> {
    const reader = new FileReader();
    reader.readAsDataURL(blob);
    return new Promise<string>((resolve, reject) => {
        reader.onloadend = () => {
            resolve(reader.result as string);
        };
        reader.onerror = reject;
    });
}

async function readLegacyInlay(id: string): Promise<InlayAsset | null> {
    try {
        return (await legacyInlayStore.getItem<InlayAsset | null>(id)) ?? null
    } catch (error) {
        console.warn('An inlay could not be read from the old inlay store:', error)
        return null
    }
}

/** The app store first; an id it lacks is looked up in this browser's old inlay store. Never throws. */
async function readInlay(id: string): Promise<InlayAsset | null> {
    if(typeof id !== 'string'){
        return null
    }
    return (await readAppInlay(id)) ?? (await readLegacyInlay(id))
}

// Returns with base64 data URI
export async function getInlayAsset(id: string){
    const img = await readInlay(id)
    if(img === null){
        return null
    }

    let data: string;
    if(img.data instanceof Blob){
        data = await blobToBase64(img.data)
    } else {
        data = img.data as string
    }

    return { ...img, data }
}

function withBlobData(img: InlayAsset){
    let data: Blob;
    if(typeof img.data === 'string'){
        const decoded = base64ToBlob(img.data)
        if(decoded === null){
            return null
        }
        data = decoded
    } else {
        data = img.data
    }

    return { ...img, data }
}

// Returns with Blob; a string value that is not a base64 data URI has none
export async function getInlayAssetBlob(id: string){
    const img = await readInlay(id)
    if(img === null){
        return null
    }
    return withBlobData(img)
}

export type { InlayRender, InlayRenderSource } from "./inlayRenderCache";

/**
 * An object URL over a zero-copy retyped view of `blob`. The type of the URL is
 * the closed display table's for the inlay's kind and ext; the Blob's own type
 * (a restored backup's, an old store's, a data URI header's) never decides how
 * the page treats the URL.
 */
function objectUrlOfInlayBlob(type: unknown, ext: unknown, blob: Blob): string {
    return URL.createObjectURL(blob.slice(0, blob.size, displayMimeOfInlay(type, ext)))
}

/** The render of an inlay asset read as bytes or from the old store: a signature has no URL, anything else is shown through an object URL over a retyped view of its Blob: the old store's own Blob, or a Blob built in memory from bytes or a data URI. */
function renderOfAsset(img: InlayAsset): { render: InlayRender, objectUrl: string | null } | null {
    if(img.type === 'signature'){
        return { render: { type: 'signature', url: '', source: 'signature' }, objectUrl: null }
    }
    const shown = withBlobData(img)
    if(shown === null){
        return null
    }
    const url = objectUrlOfInlayBlob(img.type, img.ext, shown.data)
    return { render: { type: img.type, url, source: 'memory-blob' }, objectUrl: url }
}

/**
 * How a Blob inlay of the app store reaches the page without being read into
 * memory: the store's own URL.
 * `null` when the store gives none, and the render reads the bytes instead, except for a
 * Blob video that Android would read whole above its limit, which the render
 * withholds. A store that cannot give a URL (the Node server without an asset
 * token) is skipped. An image the platform withholds never reaches here: the
 * render decides that from the record before any delivery. A string video or
 * audio it withholds is not a Blob record and never reaches here either.
 */
async function deliverStoredInlay(store: ByteStore, record: InlayRecord): Promise<{ render: InlayRender, objectUrl: string | null } | null> {
    const type = typeof record.fields.type === 'string' ? record.fields.type : ''
    if(store.urlFor !== undefined){
        try {
            const url = await store.urlFor(record.body)
            // An image URL is a whole read on Android; the body key is write-once, so its stored length stays true while the key exists. A media URL is a Range read and is never registered.
            if(type === 'image' && isAndroidTransport()){
                rememberWholeReadUrlOfSize(url, record.body, inlayRecordSize(record))
            }
            return { render: { type, url, source: 'store-url' }, objectUrl: null }
        } catch {
            // No URL for this key on this page: the Blob or the bytes are used.
        }
    }
    return null
}

/** The render of a file this platform does not load: its name (the id when it has none) and size, and no URL. */
function withheldRender(type: 'image' | 'video' | 'audio', storedName: unknown, id: string, size: number): { render: InlayRender, objectUrl: string | null } {
    const name = typeof storedName === 'string' && storedName.trim() !== '' ? storedName : id
    return { render: { type, url: '', source: 'withheld', name, size }, objectUrl: null }
}

/** The withheld render of a string-stored video or audio of the estimated `size` that Android does not decode, or `null`. */
function stringMediaWithheld(type: unknown, storedName: unknown, id: string, size: number): { render: InlayRender, objectUrl: string | null } | null {
    const kind = withheldStringMediaKind(type, size, isAndroidTransport())
    return kind === null ? null : withheldRender(kind, storedName, id, size)
}

async function resolveInlayRender(id: string): Promise<{ render: InlayRender, objectUrl: string | null } | null> {
    let store: ByteStore | null = null
    let record: InlayRecord | null = null
    try {
        store = await getAppStore()
        record = await readAppInlayRecord(store, id)
    } catch (error) {
        console.warn('An inlay could not be read from the app store:', error)
    }
    if(store !== null && record !== null){
        // An image this platform does not load is named by its record alone: its body is never read and no URL is asked for.
        if(record.fields.type === 'image' && inlayImageRenderWithheld('image', inlayRecordSize(record), isAndroidTransport(), isDesktopTransport())){
            return withheldRender('image', record.fields.name, id, inlayRecordSize(record))
        }
        // A string video or audio this platform does not decode is named by its record alone, before its body is read.
        if(record.repr === 'string'){
            const withheld = stringMediaWithheld(record.fields.type, record.fields.name, id, inlayRecordSize(record))
            if(withheld !== null){
                return withheld
            }
        }
        // A string body (a `data:` URI) and a signature are decoded from bytes; only a Blob body is delivered by URL.
        if(record.repr === 'blob' && record.fields.type !== 'signature'){
            const delivered = await deliverStoredInlay(store, record)
            if(delivered !== null){
                return delivered
            }
            // Nothing delivered the body, so it would be read whole: a Blob video Android would read whole is named by its record alone.
            if(blobVideoWholeReadWithheld(record.fields.type, inlayRecordSize(record), isAndroidTransport())){
                return withheldRender('video', record.fields.name, id, inlayRecordSize(record))
            }
        }
        const img = await readAppInlayBody(store, id, record)
        if(img !== null){
            return renderOfAsset(img)
        }
    }
    const old = await readLegacyInlay(id)
    if(old === null){
        return null
    }
    // The old store's string is already read; withholding it skips the decode copies and the Blob the cache would keep.
    if(typeof old.data === 'string'){
        const withheld = stringMediaWithheld(old.type, old.name, id, decodedTextSize(old.data.length))
        if(withheld !== null){
            return withheld
        }
    }
    return renderOfAsset(old)
}

/**
 * What the parser renders for `id`, or `null` when there is no such inlay or it
 * cannot be shown. The result is cached until the id is written or removed, so a
 * cached render reads nothing. A miss is resolved under the id's lock, after any
 * write or delete of that id in flight. Never request a render of `id` from
 * inside `withInlayLock(id)`.
 */
export async function getInlayRender(id: string): Promise<InlayRender | null> {
    if(typeof id !== 'string'){
        return null
    }
    const cached = cachedInlayRender(id)
    if(cached !== null){
        return cached
    }
    return await withInlayLock(id, async () => {
        const settled = cachedInlayRender(id)
        if(settled !== null){
            return settled
        }
        const resolved = await resolveInlayRender(id)
        if(resolved === null){
            return null
        }
        cacheInlayRender(id, resolved.render, resolved.objectUrl)
        return resolved.render
    })
}

function legacyInlaySize(value: InlayAsset): number | null {
    return value.data instanceof Blob ? value.data.size : typeof value.data === 'string' ? decodedTextSize(value.data.length) : null
}

/**
 * The fields and size of the inlay `id` without its body, or `null` when there is no such inlay. The app
 * store is asked first, for its metadata record only; an id it lacks is looked up in this browser's old
 * store. The size is of the file the body stands for: a string body is a base64 data URI, so it is
 * estimated by `decodedTextSize` as the old store's strings are; a `string16` body is not a data URI and
 * keeps its byte length. Never throws.
 */
export async function getInlaySummary(id: string): Promise<InlaySummary | null> {
    if(typeof id !== 'string'){
        return null
    }
    try {
        const store = await getAppStore()
        const record = await readAppInlayRecord(store, id)
        if(record !== null){
            return { ...(record.fields as unknown as Omit<InlayAsset, 'data'>), size: inlayRecordSize(record) }
        }
    } catch (error) {
        console.warn('An inlay could not be read from the app store:', error)
    }
    const old = await readLegacyInlay(id)
    if(old === null){
        return null
    }
    return { ...(fieldsOf(old) as Omit<InlayAsset, 'data'>), size: legacyInlaySize(old) }
}

/** The outcome of a size-capped read: the inlay as `getInlayAsset` returns it, or the summary of one held back. */
export type CappedInlayRead =
    | { status: 'read', asset: NonNullable<Awaited<ReturnType<typeof getInlayAsset>>> }
    | { status: 'too-large', summary: InlaySummary }

/**
 * `getInlayAsset` for a plugin or script read: a video or audio over the send limit is reported with its
 * summary and its body is not loaded from the app store. `null` means there is no readable inlay, as for
 * `getInlayAsset`. The caller reports a held-back file; this does not.
 */
export async function getInlayAssetCapped(id: string): Promise<CappedInlayRead | null> {
    const summary = await getInlaySummary(id)
    if(summary === null){
        return null
    }
    if(inlayReadVerdict(summary) === 'too-large'){
        return { status: 'too-large', summary }
    }
    const asset = await getInlayAsset(id)
    if(asset === null){
        return null
    }
    return { status: 'read', asset }
}

/** What a staged draft attachment shows: a media element over a render URL, or a chip with the file's name and size. */
export type InlayDraftPreview =
    | { kind: 'media', type: 'image' | 'video' | 'audio', url: string }
    | { kind: 'file', name: string, size: number | null }

/**
 * The preview of a staged attachment, or `null` when there is no such inlay. No body is read into the
 * page as a data URI: a video on Android is always a chip; everything else is
 * shown through the render of the id (which the sent message reuses). A signature, an unknown type, a
 * file the render withholds (an image, or a string video or audio, over the Android limit) and a render
 * that cannot be had are chips.
 */
export async function getInlayDraftPreview(id: string): Promise<InlayDraftPreview | null> {
    const summary = await getInlaySummary(id)
    if(summary === null){
        return null
    }
    const chip: InlayDraftPreview = {
        kind: 'file',
        name: typeof summary.name === 'string' && summary.name !== '' ? summary.name : id,
        size: summary.size,
    }
    const type = summary.type
    if(type === 'video' && isAndroidTransport()){
        return chip
    }
    if(type === 'image' || type === 'video' || type === 'audio'){
        const render = await getInlayRender(id)
        return render === null || render.source === 'withheld' ? chip : { kind: 'media', type, url: render.url }
    }
    return chip
}

/**
 * Drops and revokes the cached render of `id`, after any render of it in flight: a miss is resolved and
 * cached under the id's lock, so a drop outside the lock could run first and leave that render behind.
 * Never rejects.
 */
export async function forgetInlayRender(id: string): Promise<void> {
    try {
        await withInlayLock(id, async () => dropInlayRender(id))
    } catch (error) {
        console.warn('A cached inlay render could not be released:', error)
    }
}

/** Every inlay of the app store and of this browser's old store, without bodies. */
export async function listInlayAssets(): Promise<[id: string, InlaySummary][]> {
    const assets: [id: string, InlaySummary][] = []
    const seen = new Set<string>()
    try {
        const store = await getAppStore()
        const { ids, keys } = await listAppInlayKeys(store)
        for (const id of ids) {
            const summary = await summarizeAppInlay(store, id, keys)
            if (summary !== null) {
                assets.push([id, summary])
                seen.add(id)
            }
        }
    } catch (error) {
        console.warn('The inlays of the app store could not be listed:', error)
    }
    let legacyIds: string[] = []
    try {
        legacyIds = await legacyInlayStore.keys()
    } catch (error) {
        console.warn('The old inlay store could not be listed:', error)
    }
    for (const id of legacyIds) {
        if (seen.has(id)) {
            continue
        }
        const value = await readLegacyInlay(id)
        if (value === null) {
            continue
        }
        assets.push([id, { ...(fieldsOf(value) as Omit<InlayAsset, 'data'>), size: legacyInlaySize(value) }])
    }
    return assets
}

export async function setInlayAsset(id: string, img: InlayAsset){
    await writeInlay(id, img)
}

/** Removes the inlay from this browser's old store first, then from the app store, so neither brings it back. */
export async function removeInlayAsset(id: string){
    await withInlayLock(id, async () => {
        // Whatever the outcome, no render of the id outlives it: the id may live in either store, or have no key at all.
        try {
            let legacyFailure: unknown = null
            let legacyFailed = false
            await inFlight(async () => {
                try {
                    await legacyInlayStore.removeItem(id)
                } catch (error) {
                    legacyFailed = true
                    legacyFailure = error
                }
            })
            const store = await getAppStore().catch((error: unknown) => {
                throw legacyFailed ? legacyFailure : error
            })
            await removeAppInlay(store, id)
            if (legacyFailed) {
                throw legacyFailure
            }
        } finally {
            dropInlayRender(id)
        }
    })
}

export function supportsInlayImage(){
    const db = getDatabase()
    return getModelInfo(db.aiModel).flags.includes(LLMFlags.hasImageInput)
}

export async function reencodeImage(img:Uint8Array){
    if(getImageType(img) === 'PNG'){
        return img
    }
    const canvas = document.createElement('canvas')
    const imgObj = new Image()
    imgObj.src = URL.createObjectURL(new Blob([asBuffer(img)], {type: `image/png`}))
    await imgObj.decode()
    let drawHeight = imgObj.height
    let drawWidth = imgObj.width
    canvas.width = drawWidth
    canvas.height = drawHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(imgObj, 0, 0, drawWidth, drawHeight)
    const b64 = canvas.toDataURL('image/png').split(',')[1]
    const b = Buffer.from(b64, 'base64')
    return b
}
