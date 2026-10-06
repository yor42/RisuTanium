// @vitest-environment happy-dom

/**
 * `selectMultipleFile` in `src/ts/util.ts` on the desktop app: the files the native
 * dialog picked are read by path through the plugin. The dialog and the plugin are
 * stand-ins, and the plugin refuses any call that carries more than 4 MiB of file
 * payload, so a read of a large file in one call fails the test. A pass is not
 * evidence about the plugin or the web view's memory behaviour.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

const CAP = 4 * 1024 * 1024

const h = vi.hoisted(() => ({
    picked: null as string[] | string | null,
    files: new Map<string, Uint8Array>(),
    readSizes: [] as number[],
    openHandles: 0,
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
    open: vi.fn(async () => h.picked),
}))

vi.mock('@tauri-apps/api/path', () => ({
    basename: vi.fn(async (path: string) => path.split(/[\\/]/).pop()),
}))

vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'windows' }))

vi.mock('@tauri-apps/plugin-fs', () => ({
    readFile: vi.fn(async (path: string) => {
        const data = h.files.get(path) ?? new Uint8Array()
        if (data.length > CAP) {
            throw new Error(`readFile carries ${data.length} bytes, above the per-call bound`)
        }
        return data
    }),
    open: vi.fn(async (path: string) => {
        const data = h.files.get(path)
        if (data === undefined) {
            throw `failed to open ${path} (os error 2)`
        }
        let position = 0
        h.openHandles++
        return {
            read: async (buffer: Uint8Array) => {
                h.readSizes.push(buffer.byteLength)
                if (buffer.byteLength > CAP) {
                    throw new Error(`read asks for ${buffer.byteLength} bytes, above the per-call bound`)
                }
                if (position >= data.length) {
                    return null
                }
                const count = Math.min(buffer.byteLength, data.length - position, 1000 * 1000)
                buffer.set(data.subarray(position, position + count), 0)
                position += count
                return count
            },
            close: async () => { h.openHandles-- },
        }
    }),
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: true,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({ characters: [] })),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} },
    selectedCharID: { subscribe: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/characters'), () => ({
    createBlankChar: vi.fn(),
    getCharImage: vi.fn(),
}) as unknown as typeof import('src/ts/characters'))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
    getCurrentWebviewWindow: vi.fn(() => ({})),
}))

vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: {} }))

import { selectMultipleFile } from 'src/ts/util'

function patterned(length: number): Uint8Array {
    return Uint8Array.from({ length }, (_, i) => (i * 19 + 5) % 251)
}

beforeEach(() => {
    h.picked = null
    h.files.clear()
    h.readSizes = []
    h.openHandles = 0
})

describe('selectMultipleFile on the desktop app', () => {
    test('per-call bound: a picked file of several pieces is read with calls of at most 4 MiB and comes back exactly, named by its base name', async () => {
        const big = patterned(CAP * 2 + 17)
        h.files.set('C:\\Users\\u\\cards\\big.charx', big)
        h.files.set('C:\\Users\\u\\cards\\small.risum', patterned(10))
        h.picked = ['C:\\Users\\u\\cards\\big.charx', 'C:\\Users\\u\\cards\\small.risum']

        const picked = await selectMultipleFile(['charx', 'risum'])

        expect(picked?.map((file) => file.name)).toEqual(['big.charx', 'small.risum'])
        expect(Buffer.compare(Buffer.from(picked?.[0].data ?? []), Buffer.from(big))).toBe(0)
        expect(Array.from(picked?.[1].data ?? [])).toEqual(Array.from(patterned(10)))
        expect(Math.max(...h.readSizes)).toBeLessThanOrEqual(CAP)
        expect(h.openHandles).toBe(0)
    })

    test('a single path the dialog answers instead of a list is read the same way (guard)', async () => {
        h.files.set('/home/u/one.png', patterned(33))
        h.picked = '/home/u/one.png'

        const picked = await selectMultipleFile(['png'])

        expect(picked?.map((file) => file.name)).toEqual(['one.png'])
        expect(Array.from(picked?.[0].data ?? [])).toEqual(Array.from(patterned(33)))
    })

    test('a cancelled dialog answers null and reads nothing (guard)', async () => {
        h.picked = null

        expect(await selectMultipleFile(['png'])).toBeNull()
        expect(h.readSizes).toEqual([])
    })
})
