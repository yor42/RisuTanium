/**
 * How inlays are stored in the app store and read back: representation kept
 * byte for byte, one complete-or-invisible write, deletion that stays deleted,
 * reads that never throw, the attachment size limit, and the explorer listing.
 * The old `inlay` LocalForage database is an in-memory map.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import { NODE_BODY_LIMIT_BYTES } from 'src/ts/storage/nodeBodyLimit'
import { chokePointInFlight, resetBusyActionsForTest } from '../../memory/busyActions'
import { inlayBodyKey, inlayMetaKey } from '../inlayKeys'
import { legacyInlayStore, readAppInlay } from '../inlayStore'
import { createMemoryByteStore, type MemoryByteStore } from './memoryByteStore'
import {
    getInlayAsset,
    getInlayAssetBlob,
    inlayAttachmentLimit,
    inlayLimits,
    isInlayRefusal,
    listInlayAssets,
    postInlayAsset,
    removeInlayAsset,
    setInlayAsset,
    type InlayAsset,
} from '../inlays'

//#region module mocks

const h = vi.hoisted(() => ({
    legacy: new Map<string, unknown>(),
    /** Old-store removals and app-store deletes, in the order they happened. */
    removalLog: [] as string[],
    node: false,
}))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async (key: string) => h.legacy.get(key) ?? null),
            setItem: vi.fn(async (key: string, value: unknown) => { h.legacy.set(key, value) }),
            removeItem: vi.fn(async (key: string) => {
                h.removalLog.push(`old:${key}`)
                h.legacy.delete(key)
            }),
            keys: vi.fn(async () => [...h.legacy.keys()]),
        }),
    },
}))

vi.mock(import('src/ts/platform'), async (importOriginal) => {
    const actual = await importOriginal()
    return Object.defineProperty({ ...actual }, 'isNodeServer', { get: () => h.node, enumerable: true }) as typeof actual
})

vi.mock(import('src/ts/globalApi.svelte'), () => {
    const stub: Record<string, unknown> = { forageStorage: {} }
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vi.fn()),
        has: () => true,
    }) as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/stores.svelte'), () => {
    const stub: Record<string, unknown> = { DBState: { db: {} }, selIdState: { selId: -1 } }
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vi.fn()),
        has: () => true,
    }) as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock('uuid', () => ({ v4: vi.fn(() => 'fixed-uuid') }))
vi.mock(import('src/ts/media'), () => ({ getImageType: vi.fn() }))
vi.mock(import('src/ts/model/modellist'), () => ({ getModelInfo: vi.fn() }))
vi.mock(import('src/ts/storage/database.svelte'), () => ({ getDatabase: vi.fn() }))
vi.mock(import('src/ts/util'), () => ({ asBuffer: (arr: Uint8Array) => arr }) as typeof import('src/ts/util'))

//#endregion

let appStore: MemoryByteStore

beforeEach(() => {
    h.legacy.clear()
    h.removalLog.length = 0
    h.node = false
    resetBusyActionsForTest()
    appStore = createMemoryByteStore()
    injectAppStore(appStore)
})

async function dataUriOf(blob: Blob): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(blob)
    })
}

function image(data: string | Blob, extra: Record<string, unknown> = {}): InlayAsset {
    return { name: 'n.png', ext: 'png', type: 'image', width: 3, height: 2, data, ...extra } as InlayAsset
}

describe('the representation of a stored inlay', () => {
    test('a signature reads back as the identical JSON string', async () => {
        const json = JSON.stringify({ signatures: [{ type: 'text', content: 'é "x"' }], sourceFormat: 1, source: 's' })
        await setInlayAsset('sig', { name: 'sig', ext: 'json', type: 'signature', data: json })
        expect((await getInlayAsset('sig'))!.data).toBe(json)
    })

    test('a string that is not well-formed text reads back unchanged', async () => {
        const odd = 'a\uD800b\uDC00'
        await setInlayAsset('odd', image(odd))
        expect((await getInlayAsset('odd'))!.data).toBe(odd)
    })

    test.each([
        ['an empty type', ''],
        ['a non-standard audio type', 'audio/mp3'],
        ['a standard type', 'image/png'],
    ])('a Blob with %s reads back with the data URI the Blob itself gives', async (_name, type) => {
        const blob = new Blob([new Uint8Array([0, 1, 2, 250, 251])], { type })
        await setInlayAsset('blob', image(blob))
        expect((await getInlayAsset('blob'))!.data).toBe(await dataUriOf(blob))
        const asBlob = (await getInlayAssetBlob('blob'))!.data as Blob
        expect(asBlob.type).toBe(type)
        expect(new Uint8Array(await asBlob.arrayBuffer())).toEqual(new Uint8Array([0, 1, 2, 250, 251]))
    })

    test('a field the type does not know survives a write and reaches the reader', async () => {
        await setInlayAsset('extra', image(new Blob(['x']), { custom: { a: [1, 2] } }))
        expect(await getInlayAsset('extra')).toMatchObject({ custom: { a: [1, 2] }, name: 'n.png', width: 3, height: 2 })
    })

    test('a zero-length Blob is a value', async () => {
        await setInlayAsset('empty', image(new Blob([], { type: 'image/png' })))
        expect(await getInlayAsset('empty')).not.toBeNull()
    })

    test.each([
        ['a legacy base64 data URI', 'data:image/png;base64,aGVsbG8='],
        ['a legacy data URI that is not base64', 'data:text/plain,hello'],
    ])('%s in the old store is returned verbatim', async (_name, text) => {
        h.legacy.set('old', image(text))
        expect((await getInlayAsset('old'))!.data).toBe(text)
    })
})

describe('reading a string value as a Blob', () => {
    test('a base64 data URI gives a Blob of its bytes and type', async () => {
        h.legacy.set('b64', image('data:image/png;base64,aGVsbG8='))
        const blob = (await getInlayAssetBlob('b64'))!.data
        expect(blob.type).toBe('image/png')
        expect(await blob.text()).toBe('hello')
    })

    test.each([
        ['signature JSON', '{"signatures":[]}'],
        ['a data URI that is not base64', 'data:text/plain,hello'],
        ['a base64 data URI with a damaged payload', 'data:image/png;base64,@@@'],
    ])('%s gives null and does not write', async (_name, text) => {
        h.legacy.set('s', image(text))
        await expect(getInlayAssetBlob('s')).resolves.toBeNull()
        expect(appStore.writes).toEqual([])
    })
})

describe('reading an id that is not there', () => {
    test.each([
        ['an unknown uuid', '3f2b8c1e-5a4d-4e7b-9c6f-0a1b2c3d4e5f'],
        ['a path', '../../x'],
        ['an overlong id', 'x'.repeat(300)],
        ['a lone surrogate', 'a\uD800'],
        ['an empty id', ''],
    ])('%s reads as null without throwing', async (_name, id) => {
        await expect(getInlayAsset(id)).resolves.toBeNull()
        await expect(getInlayAssetBlob(id)).resolves.toBeNull()
    })

    test('a non-string id reads as null', async () => {
        await expect(getInlayAsset(42 as unknown as string)).resolves.toBeNull()
    })

    test('an unmappable id is refused on write and writes nothing', async () => {
        await expect(setInlayAsset('x'.repeat(300), image(new Blob(['x'])))).rejects.toThrow()
        expect(appStore.writes).toEqual([])
    })

    test('metadata that is empty, unparseable, or not the format reads as not found', async () => {
        const key = inlayMetaKey('m')!
        for (const bytes of [new Uint8Array(0), new TextEncoder().encode('{nope'), new TextEncoder().encode('{"v":2}'), new TextEncoder().encode('null')]) {
            appStore.files.set(key, bytes)
            await expect(getInlayAsset('m')).resolves.toBeNull()
        }
    })

    test('metadata whose body is missing or has another length reads as not found', async () => {
        await setInlayAsset('m', image(new Blob(['abcdef'])))
        const body = [...appStore.files.keys()].find((key) => key.startsWith('inlays/b-'))!
        appStore.files.set(body, new Uint8Array(2))
        await expect(getInlayAsset('m')).resolves.toBeNull()
        appStore.files.delete(body)
        await expect(getInlayAsset('m')).resolves.toBeNull()
    })

    test('an app store that fails to read reads as not found, and the old store answers', async () => {
        h.legacy.set('f', image('data:image/png;base64,aGVsbG8='))
        appStore.failRead = () => new Error('disk gone')
        expect((await getInlayAsset('f'))!.data).toBe('data:image/png;base64,aGVsbG8=')
    })
})

describe('an overwrite is old or new, never mixed', () => {
    test('a failure of the body write keeps the old inlay', async () => {
        await setInlayAsset('o', image(new Blob(['old'])))
        appStore.failWrite = (key) => (key.startsWith('inlays/b-') ? new Error('body failed') : null)
        await expect(setInlayAsset('o', image(new Blob(['new'])))).rejects.toThrow('body failed')
        expect(await (await getInlayAssetBlob('o'))!.data.text()).toBe('old')
    })

    test('a failure of the metadata write keeps the old inlay and leaves no new body', async () => {
        await setInlayAsset('o', image(new Blob(['old'])))
        const before = new Set(appStore.files.keys())
        appStore.failWrite = (key) => (key.startsWith('inlays/m-') ? new Error('meta failed') : null)
        await expect(setInlayAsset('o', image(new Blob(['new'])))).rejects.toThrow('meta failed')
        appStore.failWrite = null
        expect(await (await getInlayAssetBlob('o'))!.data.text()).toBe('old')
        expect(new Set(appStore.files.keys())).toEqual(before)
    })

    test('a successful overwrite reads the new body and removes the old one', async () => {
        await setInlayAsset('o', image(new Blob(['old'])))
        await setInlayAsset('o', image(new Blob(['new!'])))
        expect(await (await getInlayAssetBlob('o'))!.data.text()).toBe('new!')
        expect([...appStore.files.keys()].filter((key) => key.startsWith('inlays/b-')).length).toBe(1)
    })

    test('a reader whose body was replaced after it read the metadata reads the new inlay', async () => {
        await setInlayAsset('o', image(new Blob(['old'])))
        const realRead = appStore.read.bind(appStore)
        let replaced = false
        appStore.read = async (key) => {
            if (key.startsWith('inlays/b-') && !replaced) {
                replaced = true
                await setInlayAsset('o', image(new Blob(['newer'])))
            }
            return await realRead(key)
        }
        expect(await (await getInlayAssetBlob('o'))!.data.text()).toBe('newer')
    })

    test('a new id is invisible until its metadata is written', async () => {
        let seenAtCommit: InlayAsset | null | undefined
        let bodyStoredAtCommit = false
        const realWrite = appStore.write.bind(appStore)
        appStore.write = async (key, bytes, condition) => {
            if (key.startsWith('inlays/m-')) {
                bodyStoredAtCommit = [...appStore.files.keys()].some((stored) => stored.startsWith('inlays/b-'))
                seenAtCommit = await readAppInlay('new')
            }
            return await realWrite(key, bytes, condition)
        }
        await setInlayAsset('new', image(new Blob(['x'])))
        expect(bodyStoredAtCommit).toBe(true)
        expect(seenAtCommit).toBeNull()
        expect(await getInlayAsset('new')).not.toBeNull()
    })
})

describe('deleting an inlay', () => {
    test('removes it from the app store and from the old store, old store first', async () => {
        await setInlayAsset('d', image(new Blob(['x'])))
        h.legacy.set('d', image('data:image/png;base64,aGVsbG8='))
        const realDelete = appStore.delete.bind(appStore)
        appStore.delete = async (key, condition) => {
            h.removalLog.push(`app:${key}`)
            return realDelete(key, condition)
        }
        await removeInlayAsset('d')
        expect(h.removalLog.length).toBe(3)
        expect(h.removalLog[0]).toBe('old:d')
        expect(h.removalLog[1].startsWith('app:inlays/m-')).toBe(true)
        expect(h.removalLog[2].startsWith('app:inlays/b-')).toBe(true)
        expect(await getInlayAsset('d')).toBeNull()
        expect(appStore.files.size).toBe(0)
        expect(h.legacy.has('d')).toBe(false)
    })

    test('an id that is not there, or has no key, deletes without throwing', async () => {
        await expect(removeInlayAsset('nope')).resolves.toBeUndefined()
        await expect(removeInlayAsset('x'.repeat(300))).resolves.toBeUndefined()
    })

    test('still removes the app store copy when the old store fails, then reports the failure', async () => {
        await setInlayAsset('d', image(new Blob(['x'])))
        h.legacy.set('d', image('data:image/png;base64,aGVsbG8='))
        vi.mocked(legacyInlayStore.removeItem).mockRejectedValueOnce(new Error('old store down'))
        await expect(removeInlayAsset('d')).rejects.toThrow('old store down')
        expect(appStore.files.size).toBe(0)
    })
})

describe('the attachment size limit', () => {
    const FILE = (size: number) => ({ name: 'clip.mp4', data: new Uint8Array(size) })

    test('on a page that is not the Node server the limit is 200 MiB', () => {
        expect(inlayLimits.attachmentBytes).toBe(200 * 1024 * 1024)
        expect(inlayAttachmentLimit()).toBe(200 * 1024 * 1024)
    })

    test('on the Node server the limit is the smaller of 200 MiB and the body limit of one write', () => {
        h.node = true
        expect(inlayAttachmentLimit()).toBe(Math.min(200 * 1024 * 1024, NODE_BODY_LIMIT_BYTES))
    })

    test.each([false, true])('one byte over the limit is refused and writes nothing (Node: %s)', async (node) => {
        h.node = node
        const limit = inlayAttachmentLimit()
        const fake = { name: 'clip.mp4', data: { byteLength: limit + 1 } as unknown as Uint8Array }
        const result = await postInlayAsset(fake)
        expect(isInlayRefusal(result)).toBe(true)
        expect(result).toEqual({ refused: 'too-large', name: 'clip.mp4', limit })
        expect(appStore.writes).toEqual([])
    })

    test.each([false, true])('a file exactly at the limit is accepted (Node: %s)', async (node) => {
        h.node = node
        const saved = inlayLimits.attachmentBytes
        inlayLimits.attachmentBytes = 8
        try {
            const result = await postInlayAsset(FILE(8))
            expect(result).toBe('fixed-uuid')
            expect(await getInlayAsset('fixed-uuid')).toMatchObject({ type: 'video' })
            expect(isInlayRefusal(await postInlayAsset(FILE(9)))).toBe(true)
        } finally {
            inlayLimits.attachmentBytes = saved
        }
    })

    test('audio is limited like video, and an unsupported type is null and not a refusal', async () => {
        const limit = inlayAttachmentLimit()
        const audio = await postInlayAsset({ name: 'a.mp3', data: { byteLength: limit + 1 } as unknown as Uint8Array })
        expect(isInlayRefusal(audio)).toBe(true)
        const other = await postInlayAsset({ name: 'a.txt', data: { byteLength: limit + 1 } as unknown as Uint8Array })
        expect(other).toBeNull()
        expect(isInlayRefusal(other)).toBe(false)
    })

    test('a file over a lowered limit is refused as audio or video', async () => {
        const saved = inlayLimits.attachmentBytes
        inlayLimits.attachmentBytes = 1
        try {
            expect(isInlayRefusal(await postInlayAsset({ name: 'a.mp4', data: new Uint8Array(2) }))).toBe(true)
        } finally {
            inlayLimits.attachmentBytes = saved
        }
    })

    test('an image over the limit is stored and not refused', async () => {
        const saved = inlayLimits.attachmentBytes
        inlayLimits.attachmentBytes = 1
        const createElement = document.createElement.bind(document)
        const spy = vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
            const element = createElement(tag)
            if (tag === 'canvas') {
                Object.assign(element, {
                    getContext: () => ({ drawImage: () => { } }),
                    toBlob: (done: BlobCallback) => done(new Blob(['png'], { type: 'image/png' })),
                })
            }
            return element
        }) as typeof document.createElement)
        vi.stubGlobal('Image', class {
            width = 4
            height = 4
            set onload(fn: () => void) { fn() }
            set src(_url: string) { }
        })
        const createObjectURL = URL.createObjectURL
        URL.createObjectURL = () => 'blob:image'
        try {
            const result = await postInlayAsset({ name: 'a.png', data: new Uint8Array(1000) })
            expect(result).toBe('fixed-uuid')
            expect(isInlayRefusal(result)).toBe(false)
            expect(await getInlayAsset('fixed-uuid')).toMatchObject({ type: 'image' })
        } finally {
            inlayLimits.attachmentBytes = saved
            URL.createObjectURL = createObjectURL
            spy.mockRestore()
            vi.unstubAllGlobals()
        }
    })
})

describe('listing inlays for the explorer', () => {
    test('lists the app store and the old store, reads no body, and prefers the app store for an id in both', async () => {
        await setInlayAsset('both', image(new Blob(['12345']), { name: 'app-name' }))
        await setInlayAsset('only-app', image(new Blob(['1234567']), { name: 'only-app' }))
        h.legacy.set('both', image(new Blob(['x']), { name: 'old-name' }))
        h.legacy.set('only-old', image('data:image/png;base64,aGVsbG8=', { name: 'only-old' }))
        appStore.reads.length = 0

        const listed = await listInlayAssets()

        const byId = new Map(listed)
        expect([...byId.keys()].sort()).toEqual(['both', 'only-app', 'only-old'])
        expect(byId.get('both')).toMatchObject({ name: 'app-name', size: 5 })
        expect(byId.get('only-app')).toMatchObject({ size: 7 })
        expect(byId.get('only-old')).toMatchObject({ name: 'only-old', size: 22 })
        expect(listed.every(([, summary]) => !('data' in summary))).toBe(true)
        expect(appStore.reads.every((key) => key.startsWith('inlays/m-'))).toBe(true)
    })

    test('does not list an inlay whose body is missing from the app store', async () => {
        await setInlayAsset('half', image(new Blob(['abc'])))
        for (const key of [...appStore.files.keys()]) {
            if (key.startsWith('inlays/b-')) {
                appStore.files.delete(key)
            }
        }
        expect(await listInlayAssets()).toEqual([])
    })

    test('keeps listing the old store when the app store cannot be listed', async () => {
        h.legacy.set('old', image(new Blob(['x'])))
        appStore.list = async () => { throw new Error('list failed') }
        expect((await listInlayAssets()).map(([id]) => id)).toEqual(['old'])
    })
})

describe('the metadata keys of written inlays', () => {
    test('a write stores one metadata key and one body key under the inlay folder', async () => {
        await setInlayAsset('k', image(new Blob(['x'])))
        const keys = [...appStore.files.keys()].sort()
        expect(keys.length).toBe(2)
        expect(keys[1]).toBe(inlayMetaKey('k'))
        expect(keys[0].startsWith(inlayBodyKey('k', '')!)).toBe(true)
        expect(chokePointInFlight('inlay')).toBe(0)
    })
})
