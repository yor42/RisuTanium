// @vitest-environment node
/**
 * A healthy browser profile whose IndexedDB open is refused once
 * (`src/ts/storage/store/appStore.ts`): the page gets no store, nothing is read
 * or written, and the data in the database is exactly what it was, so a reload
 * boots the profile unchanged. LocalForage remembers a failed open for the life
 * of its module, which is why this runs in a file of its own: the test seeds
 * the database through the raw IndexedDB API and the open that fails is the
 * first one LocalForage makes in this module registry. `fake-indexeddb` stands
 * in for the browser; a pass is no evidence about a real browser.
 */
import 'fake-indexeddb/auto'
import { describe, expect, test, vi } from 'vitest'

const MAIN = 'database/database.bin'

const h = vi.hoisted(() => ({
    forage: { Init: async (): Promise<void> => { }, realStorage: {} as unknown },
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    get forageStorage() { return h.forage },
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock('src/lang', () => ({ language: {} }))
vi.mock('src/ts/util', () => ({ asBuffer: (value: Uint8Array) => value }))
vi.mock('src/ts/alert', () => ({ alertError: vi.fn(), alertInput: vi.fn(), waitAlert: vi.fn() }))
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'linux' }))

/** Creates the `risuai` database the way LocalForage 1.10 lays it out, holding `bytes` under the main file's key, with no LocalForage involved. */
function seedRawProfile(bytes: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('risuai', 2)
        request.onerror = () => reject(request.error)
        request.onupgradeneeded = () => {
            request.result.createObjectStore('keyvaluepairs')
            request.result.createObjectStore('local-forage-detect-blob-support')
            request.transaction!.objectStore('keyvaluepairs').put(bytes, MAIN)
        }
        request.onsuccess = () => {
            request.result.close()
            resolve()
        }
    })
}

function readRaw(): Promise<number[]> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('risuai')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
            const database = request.result
            const read = database.transaction('keyvaluepairs', 'readonly').objectStore('keyvaluepairs').get(MAIN)
            read.onsuccess = () => {
                database.close()
                resolve(Array.from(read.result as Uint8Array))
            }
            read.onerror = () => reject(read.error)
        }
    })
}

describe('a one-off refused open of a healthy IndexedDB profile', () => {
    test('the page gets no store, nothing is written, and the profile\'s data is unchanged', async () => {
        await seedRawProfile(Uint8Array.from([1, 2, 3]))
        const app = await import('src/ts/storage/store/appStore')
        const put = vi.spyOn(IDBObjectStore.prototype, 'put')
        const remove = vi.spyOn(IDBObjectStore.prototype, 'delete')
        const clear = vi.spyOn(IDBObjectStore.prototype, 'clear')
        vi.spyOn(IDBFactory.prototype, 'open').mockImplementationOnce(() => {
            throw new DOMException('the open was refused once', 'SecurityError')
        })

        await expect(app.getAppStore()).rejects.toBeInstanceOf(app.AppStoreUnavailableError)
        await expect(app.readMainFile()).rejects.toBeInstanceOf(app.AppStoreUnavailableError)

        expect(put).not.toHaveBeenCalled()
        expect(remove).not.toHaveBeenCalled()
        expect(clear).not.toHaveBeenCalled()
        vi.restoreAllMocks()
        expect(await readRaw()).toEqual([1, 2, 3])
    })
})
