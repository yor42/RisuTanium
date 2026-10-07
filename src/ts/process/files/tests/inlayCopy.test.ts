/**
 * The background copy of the old `inlay` LocalForage database into the app
 * store: readable before, during and after; never overwrites or resurrects;
 * residue stays readable; a settled start lists nothing; quota and read-only
 * pages are respected. Synthetic data only.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import { chokePointInFlight, resetBusyActionsForTest } from '../../memory/busyActions'
import { inlayMetaKey } from '../inlayKeys'
import { inlayLimits, readAppInlay } from '../inlayStore'
import { runInlayCopy, type InlayCopyEnvironment } from '../inlayCopy'
import { createMemoryByteStore, type MemoryByteStore } from './memoryByteStore'
import {
    getInlayAsset,
    getInlayAssetBlob,
    listInlayAssets,
    removeInlayAsset,
    setInlayAsset,
    type InlayAsset,
} from '../inlays'

//#region module mocks

const h = vi.hoisted(() => ({
    legacy: new Map<string, unknown>(),
    keysCalls: 0,
    afterKeys: null as null | (() => void),
    holdGet: new Map<string, Promise<void>>(),
    failGet: new Set<string>(),
    node: false,
}))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async (key: string) => {
                await h.holdGet.get(key)
                if (h.failGet.has(key)) {
                    throw new DOMException('The stored value cannot be read', 'UnknownError')
                }
                return h.legacy.get(key) ?? null
            }),
            setItem: vi.fn(async (key: string, value: unknown) => { h.legacy.set(key, value) }),
            removeItem: vi.fn(async (key: string) => { h.legacy.delete(key) }),
            keys: vi.fn(async () => {
                h.keysCalls++
                const keys = [...h.legacy.keys()]
                h.afterKeys?.()
                return keys
            }),
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

const MIB = 1024 * 1024

let appStore: MemoryByteStore
let flags: Map<string, string>
let env: InlayCopyEnvironment
let estimate: { quota?: number, usage?: number } | undefined

function legacyImage(text: string, extra: Record<string, unknown> = {}): InlayAsset {
    return { name: `${text}.png`, ext: 'png', type: 'image', width: 2, height: 2, data: new Blob([text], { type: 'image/png' }), ...extra } as InlayAsset
}

beforeEach(() => {
    h.legacy.clear()
    h.keysCalls = 0
    h.afterKeys = null
    h.holdGet.clear()
    h.failGet.clear()
    h.node = false
    resetBusyActionsForTest()
    appStore = createMemoryByteStore()
    injectAppStore(appStore)
    flags = new Map()
    estimate = undefined
    env = {
        flags: { getItem: (key) => flags.get(key) ?? null, setItem: (key, value) => { flags.set(key, value) } },
        estimate: async () => estimate,
        withTabLock: async (work) => { await work(); return true },
    }
})

async function snapshot(id: string) {
    return await getInlayAsset(id)
}

describe('copying the old store', () => {
    test('every entry reads the same before and after, and the old entries stay', async () => {
        h.legacy.set('a', legacyImage('aa', { custom: 7 }))
        h.legacy.set('b', legacyImage('bb', { name: 'b', type: 'audio' }))
        h.legacy.set('c', { name: 'c', ext: 'json', type: 'signature', data: '{"s":1}' })
        h.legacy.set('d', legacyImage('x', { data: 'data:image/png;base64,aGVsbG8=' }))
        h.legacy.set('e', legacyImage('e', { data: new Blob(['e']) }))
        const before = new Map<string, unknown>()
        for (const id of h.legacy.keys()) {
            before.set(id, await snapshot(id))
        }
        expect(appStore.files.size).toBe(0)

        await expect(runInlayCopy(env)).resolves.toBe('done')

        for (const id of h.legacy.keys()) {
            expect(await readAppInlay(id)).not.toBeNull()
            expect(await snapshot(id)).toEqual(before.get(id))
        }
        expect(h.legacy.size).toBe(5)
        expect(JSON.parse(flags.get('inlayCopyDone')!)).toEqual({ v: 1, residual: [] })
    })

    test('an inlay already in the app store is not overwritten', async () => {
        h.legacy.set('a', legacyImage('old'))
        await setInlayAsset('a', legacyImage('new', { name: 'newer' }))
        await runInlayCopy(env)
        expect((await getInlayAsset('a'))!.name).toBe('newer')
        expect(await (await getInlayAssetBlob('a'))!.data.text()).toBe('new')
    })

    test('an entry another tab deleted before the copy reached it is skipped', async () => {
        h.legacy.set('gone', legacyImage('g'))
        h.legacy.set('kept', legacyImage('k'))
        h.afterKeys = () => { h.legacy.delete('gone') }
        await expect(runInlayCopy(env)).resolves.toBe('done')
        expect(await readAppInlay('gone')).toBeNull()
        expect(await readAppInlay('kept')).not.toBeNull()
    })

    test('a delete during the copy window leaves the inlay gone, and no later copy brings it back', async () => {
        h.legacy.set('x', legacyImage('x'))
        h.legacy.set('y', legacyImage('y'))
        let release!: () => void
        h.holdGet.set('x', new Promise<void>((resolve) => { release = resolve }))
        const copy = runInlayCopy(env)
        await vi.waitFor(() => expect(h.holdGet.size).toBe(1))
        const removal = removeInlayAsset('x')
        release()
        await Promise.all([copy, removal])
        h.holdGet.clear()

        expect(await getInlayAsset('x')).toBeNull()
        expect(h.legacy.has('x')).toBe(false)
        flags.clear()
        await runInlayCopy(env)
        expect(await getInlayAsset('x')).toBeNull()
        expect(await readAppInlay('y')).not.toBeNull()
    })

    test('a delete while the copy holds a value it already read leaves the inlay gone', async () => {
        h.legacy.set('x', legacyImage('x'))
        let release!: () => void
        const gate = new Promise<void>((resolve) => { release = resolve })
        let reached = false
        const realWrite = appStore.write.bind(appStore)
        appStore.write = async (key, bytes, condition) => {
            if (key.startsWith('inlays/b-')) {
                reached = true
                await gate
            }
            return await realWrite(key, bytes, condition)
        }
        const copy = runInlayCopy(env)
        await vi.waitFor(() => expect(reached).toBe(true))
        const removal = removeInlayAsset('x')
        // A macrotask boundary: every microtask of a removal that nothing holds back
        // has run by then. This relies on the microtask queue draining, not on elapsed time.
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        release()
        await Promise.all([copy, removal])

        expect(await getInlayAsset('x')).toBeNull()
        expect(h.legacy.has('x')).toBe(false)
        expect(appStore.files.size).toBe(0)
    })

    test('a delete after the copy finished leaves the inlay gone in the app store and the old store', async () => {
        h.legacy.set('x', legacyImage('x'))
        await runInlayCopy(env)
        await removeInlayAsset('x')
        flags.clear()
        await runInlayCopy(env)
        expect(await getInlayAsset('x')).toBeNull()
        expect(appStore.files.size).toBe(0)
    })

    test('an entry that cannot be copied yet is retried at the next start and the rest is copied', async () => {
        for (const id of ['a', 'b', 'c']) {
            h.legacy.set(id, legacyImage(id))
        }
        let failed = false
        appStore.failWrite = (key) => {
            if (!failed && key.startsWith(`inlays/b-b.`)) {
                failed = true
                return new Error('transient')
            }
            return null
        }
        await expect(runInlayCopy(env)).resolves.toBe('incomplete')
        expect(flags.has('inlayCopyDone')).toBe(false)
        expect(await readAppInlay('a')).not.toBeNull()
        expect(await readAppInlay('b')).toBeNull()
        expect(await snapshot('b')).not.toBeNull()
        expect(await readAppInlay('c')).not.toBeNull()

        await expect(runInlayCopy(env)).resolves.toBe('done')
        expect(await readAppInlay('b')).not.toBeNull()
    })

    test('repeated write failures end this start and record nothing', async () => {
        for (const id of ['a', 'b', 'c', 'd']) {
            h.legacy.set(id, legacyImage(id))
        }
        appStore.failWrite = () => new Error('disk error')
        await expect(runInlayCopy(env)).resolves.toBe('stopped')
        expect(flags.has('inlayCopyDone')).toBe(false)
        expect(await snapshot('d')).not.toBeNull()
    })
})

describe('residue and settled starts', () => {
    test('an id without a key and a value above the Node write limit stay readable and listed, and do not stop the rest', async () => {
        h.node = true
        injectAppStore(appStore, 'node')
        const longId = 'q'.repeat(300)
        class BigBlob extends Blob {
            override get size() { return 101 * MIB }
        }
        h.legacy.set(longId, legacyImage('long'))
        h.legacy.set('big', legacyImage('big', { data: new BigBlob(['b'], { type: 'video/mp4' }) }))
        h.legacy.set('small', legacyImage('small'))

        await expect(runInlayCopy(env)).resolves.toBe('done')
        expect(JSON.parse(flags.get('inlayCopyDone')!).residual.sort()).toEqual(['big', longId].sort())
        expect(await readAppInlay('small')).not.toBeNull()
        expect(appStore.files.size).toBe(2)

        const listsAfterFirst = appStore.lists.length
        const keysAfterFirst = h.keysCalls
        for (let start = 0; start < 2; start++) {
            await expect(runInlayCopy(env)).resolves.toBe('settled')
            expect(await getInlayAsset(longId)).not.toBeNull()
            expect((await getInlayAsset('big'))!.type).toBe('image')
            expect((await listInlayAssets()).map(([id]) => id).sort()).toEqual(['big', longId, 'small'].sort())
        }
        expect(appStore.lists.length - listsAfterFirst).toBe(2)
        expect(h.keysCalls - keysAfterFirst).toBe(2)
    })

    class UnreadableBlob extends Blob {
        override arrayBuffer(): Promise<ArrayBuffer> {
            return Promise.reject(new DOMException('The blob cannot be read', 'NotReadableError'))
        }
    }

    test('unreadable entries are residue: they do not stop the entries after them, and completion is recorded', async () => {
        for (const id of ['a1', 'a2', 'a3']) {
            h.legacy.set(id, legacyImage(id, { data: new UnreadableBlob(['x'], { type: 'image/png' }) }))
        }
        h.legacy.set('z-good', legacyImage('good'))

        await expect(runInlayCopy(env)).resolves.toBe('done')
        expect(JSON.parse(flags.get('inlayCopyDone')!).residual.sort()).toEqual(['a1', 'a2', 'a3'])
        expect(await readAppInlay('z-good')).not.toBeNull()
        expect(await readAppInlay('a1')).toBeNull()
        expect(await getInlayAsset('z-good')).not.toBeNull()
        await expect(runInlayCopy(env)).resolves.toBe('settled')
    })

    test('keys whose old-store read rejects are residue, do not stop the entries after them, and completion is recorded', async () => {
        for (const id of ['a1', 'a2', 'a3']) {
            h.legacy.set(id, legacyImage(id))
            h.failGet.add(id)
        }
        h.legacy.set('z-good', legacyImage('good'))

        await expect(runInlayCopy(env)).resolves.toBe('done')
        expect(JSON.parse(flags.get('inlayCopyDone')!).residual.sort()).toEqual(['a1', 'a2', 'a3'])
        expect(await readAppInlay('z-good')).not.toBeNull()
        await expect(runInlayCopy(env)).resolves.toBe('settled')
    })

    test('one key whose old-store read rejects is residue and the next key is copied', async () => {
        h.legacy.set('bad', legacyImage('bad'))
        h.failGet.add('bad')
        h.legacy.set('good', legacyImage('good'))

        await expect(runInlayCopy(env)).resolves.toBe('done')
        expect(JSON.parse(flags.get('inlayCopyDone')!)).toEqual({ v: 1, residual: ['bad'] })
        expect(await readAppInlay('good')).not.toBeNull()
    })

    test('one unreadable entry still lets the copy complete', async () => {
        h.legacy.set('only', legacyImage('o', { data: new UnreadableBlob(['x']) }))
        await expect(runInlayCopy(env)).resolves.toBe('done')
        expect(JSON.parse(flags.get('inlayCopyDone')!)).toEqual({ v: 1, residual: ['only'] })
        await expect(runInlayCopy(env)).resolves.toBe('settled')
    })

    test('unreadable entries do not count toward the write-failure stop, which write failures still do', async () => {
        for (const id of ['a1', 'a2', 'a3', 'a4']) {
            h.legacy.set(id, legacyImage(id, { data: new UnreadableBlob(['x']) }))
        }
        h.legacy.set('z1', legacyImage('z1'))
        appStore.failWrite = () => new Error('disk error')
        await expect(runInlayCopy(env)).resolves.toBe('incomplete')
        expect(flags.has('inlayCopyDone')).toBe(false)
    })

    test.each([
        ['a Blob', () => new Blob(['123456789'], { type: 'video/mp4' })],
        ['a string', () => 'data:video/mp4;base64,AAAAAAAAAAAA'],
    ])('%s above the attachment limit is residue on every platform and its body is never read', async (_name, make) => {
        const saved = inlayLimits.attachmentBytes
        inlayLimits.attachmentBytes = 8
        try {
            const big = make()
            const arrayBuffer = big instanceof Blob ? vi.spyOn(big, 'arrayBuffer') : null
            h.legacy.set('big', legacyImage('b', { data: big }))
            h.legacy.set('small', legacyImage('s'))

            await expect(runInlayCopy(env)).resolves.toBe('done')
            expect(JSON.parse(flags.get('inlayCopyDone')!).residual).toEqual(['big'])
            expect(await readAppInlay('small')).not.toBeNull()
            expect(await readAppInlay('big')).toBeNull()
            expect(arrayBuffer?.mock.calls.length ?? 0).toBe(0)
            expect(await getInlayAsset('big')).not.toBeNull()
        } finally {
            inlayLimits.attachmentBytes = saved
        }
    })

    test('a settled start makes no inlay list call and no old-store list call', async () => {
        h.legacy.set('a', legacyImage('a'))
        await runInlayCopy(env)
        const lists = appStore.lists.length
        const keys = h.keysCalls
        const reads = appStore.reads.length
        await expect(runInlayCopy(env)).resolves.toBe('settled')
        expect(appStore.lists.length).toBe(lists)
        expect(h.keysCalls).toBe(keys)
        expect(appStore.reads.length).toBe(reads)
    })

    test('an empty old store settles at once', async () => {
        await expect(runInlayCopy(env)).resolves.toBe('done')
        await expect(runInlayCopy(env)).resolves.toBe('settled')
    })

    test('a second copy of a finished profile finds every inlay complete and writes nothing', async () => {
        h.legacy.set('a', legacyImage('a'))
        await runInlayCopy(env)
        const writes = appStore.writes.length
        flags.clear()
        await expect(runInlayCopy(env)).resolves.toBe('done')
        expect(appStore.writes.length).toBe(writes)
    })
})

describe('storage pressure and page state', () => {
    test('a quota failure ends the start, keeps saves writable and inlays readable', async () => {
        h.legacy.set('a', legacyImage('a'))
        h.legacy.set('b', legacyImage('b'))
        appStore.failWrite = (key) => (key.startsWith('inlays/') ? new DOMException('full', 'QuotaExceededError') : null)
        await expect(runInlayCopy(env)).resolves.toBe('stopped')
        expect(flags.has('inlayCopyDone')).toBe(false)
        appStore.failWrite = null
        await appStore.write('database/other.bin', new Uint8Array([1]), 'unconditional')
        expect(await snapshot('a')).not.toBeNull()
        expect(await snapshot('b')).not.toBeNull()
    })

    test('too little free space on the web ends the start before anything is written', async () => {
        injectAppStore(appStore, 'indexeddb')
        h.legacy.set('a', legacyImage('a'))
        estimate = { quota: 1000 * MIB, usage: 990 * MIB }
        await expect(runInlayCopy(env)).resolves.toBe('stopped')
        expect(appStore.writes).toEqual([])
        expect(flags.has('inlayCopyDone')).toBe(false)
    })

    test('enough free space on the web copies', async () => {
        injectAppStore(appStore, 'indexeddb')
        h.legacy.set('a', legacyImage('a'))
        estimate = { quota: 1000 * MIB, usage: 100 * MIB }
        await expect(runInlayCopy(env)).resolves.toBe('done')
        expect(await readAppInlay('a')).not.toBeNull()
    })

    test('the storage estimate is not asked on a page whose store is not the browser database', async () => {
        injectAppStore(appStore, 'node')
        h.legacy.set('a', legacyImage('a'))
        const asked = vi.fn(async () => ({ quota: 1, usage: 1 }))
        await expect(runInlayCopy({ ...env, estimate: asked })).resolves.toBe('done')
        expect(asked).not.toHaveBeenCalled()
    })

    test('a read-only page runs no copy and writes nothing', async () => {
        injectAppStore(appStore, 'opfs-transitional')
        h.legacy.set('a', legacyImage('a'))
        await expect(runInlayCopy(env)).resolves.toBe('not-run')
        expect(appStore.writes).toEqual([])
        expect(h.keysCalls).toBe(0)
    })

    test('a page whose other tab holds the copy does nothing', async () => {
        h.legacy.set('a', legacyImage('a'))
        await expect(runInlayCopy({ ...env, withTabLock: async () => false })).resolves.toBe('busy')
        expect(appStore.writes).toEqual([])
    })

    test('an old store that cannot be listed ends the start without a record', async () => {
        h.afterKeys = () => { throw new Error('idb closed') }
        h.legacy.set('a', legacyImage('a'))
        await expect(runInlayCopy(env)).resolves.toBe('not-run')
        expect(flags.has('inlayCopyDone')).toBe(false)
    })

    test('a copy write counts as in flight until it settles', async () => {
        h.legacy.set('a', legacyImage('a'))
        let release!: () => void
        const held = new Promise<void>((resolve) => { release = resolve })
        const realWrite = appStore.write.bind(appStore)
        appStore.write = async (key, bytes, condition) => {
            await held
            return realWrite(key, bytes, condition)
        }
        const copy = runInlayCopy(env)
        await vi.waitFor(() => expect(chokePointInFlight('inlay')).toBe(1))
        release()
        await copy
        expect(chokePointInFlight('inlay')).toBe(0)
    })

    test('a copy never touches the old store entries', async () => {
        const original = legacyImage('a')
        h.legacy.set('a', original)
        await runInlayCopy(env)
        expect(h.legacy.get('a')).toBe(original)
        expect(appStore.files.has(inlayMetaKey('a')!)).toBe(true)
    })
})
