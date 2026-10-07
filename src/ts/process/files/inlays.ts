import { v4 } from "uuid";
import { getImageType } from "src/ts/media";
import { getDatabase } from "../../storage/database.svelte";
import { getModelInfo, LLMFlags, LLMFormat } from "src/ts/model/modellist";
import { asBuffer } from "../../util";
import { getAppStore } from "../../storage/store/appStore";
import type { ByteStore } from "../../storage/store/contract";
import { isAndroidTransport } from "../../storage/tauriByteTransport";
import {
    cacheInlayRender,
    cachedInlayRender,
    dropInlayRender,
    type InlayRender,
} from "./inlayRenderCache";
import {
    fieldsOf,
    inFlight,
    inlayAttachmentLimit,
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

async function writeInlay(id: string, value: InlayAsset) {
    await withInlayLock(id, async () => {
        await writeAppInlay(await getAppStore(), id, value)
    })
}

export async function postInlayAsset(img:{
    name:string,
    data:Uint8Array
}): Promise<string | InlayRefusal | null> {

    const extention = img.name.split('.').at(-1)
    const imgObj = new Image()

    if(inlayImageExts.includes(extention)){
        imgObj.src = URL.createObjectURL(new Blob([asBuffer(img.data)], {type: `image/${extention}`}))

        return await writeInlayImage(imgObj, {
            name: img.name,
            ext: extention
        })
    }

    const isAudio = inlayAudioExts.includes(extention)
    const isVideo = inlayVideoExts.includes(extention)
    if(isAudio || isVideo){
        const limit = inlayAttachmentLimit()
        if(img.data.byteLength > limit){
            return { refused: 'too-large', name: img.name, limit }
        }
        const kind = isAudio ? 'audio' : 'video'
        const blob = new Blob([asBuffer(img.data)], {type: `${kind}/${extention}`})
        const imgid = v4()

        await writeInlay(imgid, {
            name: img.name,
            data: blob,
            ext: extention,
            type: kind
        })

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

/** The render of an inlay asset read as bytes or from the old store: a signature has no URL, anything else is shown through an object URL over its Blob: the old store's own Blob as it is, or a Blob built in memory from bytes or a data URI. */
function renderOfAsset(img: InlayAsset): { render: InlayRender, objectUrl: string | null } | null {
    if(img.type === 'signature'){
        return { render: { type: 'signature', url: '', source: 'signature' }, objectUrl: null }
    }
    const shown = withBlobData(img)
    if(shown === null){
        return null
    }
    const url = URL.createObjectURL(shown.data)
    return { render: { type: img.type, url, source: 'memory-blob' }, objectUrl: url }
}

/**
 * How a Blob inlay of the app store reaches the page without being read into
 * memory: the store's own URL, else an object URL over the Blob the store holds.
 * `null` when neither applies, and the bytes are read instead. The store's URL is
 * skipped for a video on Android, where a video served from a file stalls; a
 * store that cannot give a URL (the Node server without an asset token) is
 * skipped too.
 */
async function deliverStoredInlay(store: ByteStore, record: InlayRecord): Promise<{ render: InlayRender, objectUrl: string | null } | null> {
    const type = typeof record.fields.type === 'string' ? record.fields.type : ''
    if(store.urlFor !== undefined && !(type === 'video' && isAndroidTransport())){
        try {
            return { render: { type, url: await store.urlFor(record.body), source: 'store-url' }, objectUrl: null }
        } catch {
            // No URL for this key on this page: the Blob or the bytes are used.
        }
    }
    if(store.readBlob !== undefined){
        try {
            const blob = await store.readBlob(record.body)
            if(blob !== null && blob.size === record.len){
                const url = URL.createObjectURL(blob)
                return { render: { type, url, source: 'stored-blob' }, objectUrl: url }
            }
        } catch {
            // The Blob cannot be had: the bytes are read.
        }
    }
    return null
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
        // A string body (a `data:` URI) and a signature are decoded from bytes; only a Blob body is delivered by URL.
        if(record.repr === 'blob' && record.fields.type !== 'signature'){
            const delivered = await deliverStoredInlay(store, record)
            if(delivered !== null){
                return delivered
            }
        }
        const img = await readAppInlayBody(store, id, record)
        if(img !== null){
            return renderOfAsset(img)
        }
    }
    const old = await readLegacyInlay(id)
    return old === null ? null : renderOfAsset(old)
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
        const size = value.data instanceof Blob ? value.data.size : typeof value.data === 'string' ? Math.floor(value.data.length * 0.75) : null
        assets.push([id, { ...(fieldsOf(value) as Omit<InlayAsset, 'data'>), size }])
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
