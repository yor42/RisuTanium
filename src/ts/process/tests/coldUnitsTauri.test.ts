/**
 * Cold-storage units on the desktop go through the page's byte store: the real
 * `readColdStorageItem`, `setColdStorageItem`, `deleteColdStorageUnits` and
 * `listColdStorageItems` run over the real desktop files store with the
 * in-memory `tauriFsFake` (strict mode) behind `@tauri-apps/plugin-fs`. A pass
 * here says nothing about the native plugin or a real file system. A unit write
 * goes to the `write_durable` command, which `tauriFsFake` answers by putting
 * the bytes at the key in one step; the Rust command's own steps are tested in
 * `src-tauri/src/durable_write.rs`.
 *
 * Every test is labelled in its title:
 * - "guard": protects behaviour that must stay (the file layout
 *   `coldstorage/<key>.json`, the missing-file rule, the caller's handling of a
 *   rejected durable write). The test double rejects a durable write all at
 *   once and changes nothing, so the part-way atomicity of a write is owned by
 *   the Rust tests in `src-tauri/src/durable_write.rs`, not by this file;
 * - "new behaviour": asserts what only units-through-the-store does.
 */
import { compressSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import { OS_ERROR_ACCESS_DENIED } from 'src/ts/storage/tests/tauriFsFake'

const h = vi.hoisted(() => ({
    platform: { isTauri: true, isNodeServer: false },
    os: 'linux' as 'linux' | 'windows',
}))

const fakeFs = await vi.hoisted(async () => (await import('src/ts/storage/tests/tauriFsFake')).createFakeTauriFs({ strict: true }))
const desktop = await vi.hoisted(async () => (await import('src/ts/storage/tests/tauriDesktopFake')).createDesktopInvoke(fakeFs, { probeReads: true }))

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return h.platform.isTauri },
    get isNodeServer() { return h.platform.isNodeServer },
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    forageStorage: {},
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock('src/lang', () => ({
    language: { setNodePassword: 'set password', inputNodePassword: 'input password' },
}))

vi.mock('src/ts/util', () => ({
    asBuffer: (value: Uint8Array) => value,
    base64url: (source: Uint8Array | ArrayBuffer) => Buffer.from(source as Uint8Array).toString('base64url'),
    getKeypairStore: vi.fn(async () => null),
    saveKeypairStore: vi.fn(async () => { }),
}))

vi.mock('src/ts/alert', () => ({
    alertError: vi.fn(),
    alertInput: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    waitAlert: vi.fn(async () => { }),
}))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} },
    selectedCharID: writable(-1),
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
}) as unknown as typeof import('src/ts/process/index.svelte'))

vi.mock('@tauri-apps/plugin-os', () => ({ type: () => h.os }))

vi.mock('@tauri-apps/plugin-fs', () => fakeFs.module)

vi.mock('@tauri-apps/api/path', () => ({
    appDataDir: vi.fn(async () => '/appdata'),
    join: vi.fn(async (...paths: string[]) => paths.join('/')),
}))

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: vi.fn((path: string) => path), invoke: desktop.invoke }))

type ColdModule = typeof import('src/ts/process/coldstorage.svelte')

let cold: ColdModule

const UUID = '3f2b8c1e-5a47-4d9e-8b61-0c7a9d2e4f10'
const OTHER = '9a1d7c20-2b3e-4f5a-8c6d-1e2f3a4b5c6d'
const VALUE = { message: [{ time: 1, data: 'x', role: 'user' }] }
const TEMP = 'coldstorage/risu-write-0123456789abcdef.tmp'

function encodeUnit(value: unknown): Uint8Array {
    return compressSync(new TextEncoder().encode(JSON.stringify(value)))
}

function unitPath(key: string): string {
    return `coldstorage/${key}.json`
}

beforeEach(async () => {
    h.os = 'linux'
    fakeFs.reset()
    vi.resetModules()
    cold = await import('src/ts/process/coldstorage.svelte')
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'log').mockImplementation(() => { })
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('writing a unit is atomic', () => {
    test('guard: a unit write the durable command rejects returns false and leaves the earlier unit readable', async () => {
        fakeFs.plant(unitPath(UUID), encodeUnit({ n: 'earlier' }))
        const fault = fakeFs.failDurableWrites('There is not enough space on the disk. (os error 112)')

        const written = await cold.setColdStorageItem(UUID, { n: 'later' })
        fakeFs.clearFaults()

        expect(fault.fired).toBeGreaterThan(0)
        expect(written).toBe(false)
        expect(await cold.readColdStorageItem(UUID)).toEqual({ status: 'ok', value: { n: 'earlier' } })
        expect(fakeFs.listing('coldstorage')).toEqual([`${UUID}.json`])
    })

    test('new behaviour: a successful write goes through the durable command and never opens the unit path with the plugin', async () => {
        expect(await cold.setColdStorageItem(UUID, VALUE)).toBe(true)

        expect(fakeFs.durableLog).toEqual([unitPath(UUID)])
        expect(fakeFs.writeLog).toEqual([])
        expect(fakeFs.renameLog).toEqual([])
        expect(fakeFs.listing('coldstorage')).toEqual([`${UUID}.json`])
        expect(await cold.readColdStorageItem(UUID)).toEqual({ status: 'ok', value: VALUE })
    })

    test('guard: the file keeps the layout coldstorage/<key>.json that earlier builds wrote', async () => {
        fakeFs.plant(unitPath(UUID), encodeUnit(VALUE))

        expect(await cold.readColdStorageItem(UUID)).toEqual({ status: 'ok', value: VALUE })
        expect(await cold.setColdStorageItem(UUID, { n: 2 })).toBe(true)
        expect(Array.from(fakeFs.files.keys()).filter((path) => path.startsWith('coldstorage/'))).toEqual([unitPath(UUID)])
    })

    test.each([
        ['a UUID', UUID],
        ['a UUID with the _accessMeta suffix upstream wrote', UUID + '_accessMeta'],
    ])('new behaviour: %s round-trips and is listed and deleted through the store', async (_label, key) => {
        expect(await cold.setColdStorageItem(key, VALUE)).toBe(true)

        expect(await cold.readColdStorageItem(key)).toEqual({ status: 'ok', value: VALUE })
        expect((await cold.listColdStorageItems()).items).toEqual([key])
        expect(await cold.deleteColdStorageUnits([key])).toEqual([])
        expect(fakeFs.listing('coldstorage')).toEqual([])
    })
})

describe('reading a unit', () => {
    test('new behaviour: on Windows a unit read in a units folder that does not exist (os error 3) is missing', async () => {
        fakeFs.setPlatform('windows')
        h.os = 'windows'

        expect(await cold.readColdStorageItem(UUID)).toEqual({ status: 'missing' })
    })

    test('guard: on a POSIX desktop a unit read in a units folder that does not exist (os error 2) is missing', async () => {
        expect(await cold.readColdStorageItem(UUID)).toEqual({ status: 'missing' })
    })

    test('guard: a read the file system refuses is an error with no kind, not missing', async () => {
        fakeFs.plant(unitPath(UUID), encodeUnit(VALUE))
        fakeFs.failReadFiles(OS_ERROR_ACCESS_DENIED)

        const result = await cold.readColdStorageItem(UUID)

        expect(result.status).toBe('error')
        expect((result as { kind?: unknown }).kind).toBeUndefined()
    })

    test('new behaviour: a key the cold-key rule accepts but the store refuses (a leading dot) reads damaged, writes false and touches no file', async () => {
        const callsBefore = fakeFs.calls.length

        const read = await cold.readColdStorageItem('.hidden')
        const written = await cold.setColdStorageItem('.hidden', VALUE)

        expect(read.status).toBe('error')
        expect((read as { kind?: unknown }).kind).toBe('damaged')
        expect(written).toBe(false)
        expect(fakeFs.calls.length).toBe(callsBefore)
    })
})

describe('listing and deleting units', () => {
    test('guard: only the .json files directly in coldstorage/ are units; a temp file, a subfolder entry and other files are not', async () => {
        fakeFs.plant(unitPath('a'), encodeUnit(VALUE))
        fakeFs.plant(unitPath(UUID), encodeUnit(VALUE))
        fakeFs.plant('coldstorage/notes.txt', new Uint8Array([1]))
        fakeFs.plant('coldstorage/sub/inner.json', encodeUnit(VALUE))
        fakeFs.plant(TEMP, new Uint8Array([1]))

        expect((await cold.listColdStorageItems()).items.sort()).toEqual(['a', UUID].sort())
    })

    test('new behaviour: a missing units folder lists as empty', async () => {
        expect((await cold.listColdStorageItems()).items).toEqual([])
    })

    test('new behaviour: a unit already deleted by someone else counts as deleted, and a refused removal is reported for that unit only', async () => {
        fakeFs.plant(unitPath(UUID), encodeUnit(VALUE))
        fakeFs.plant(unitPath(OTHER), encodeUnit(VALUE))
        fakeFs.failRemoves(OS_ERROR_ACCESS_DENIED, (path) => path === unitPath(OTHER))

        const failed = await cold.deleteColdStorageUnits([UUID, 'already-gone', OTHER])

        expect(failed.map((entry) => entry.key)).toEqual([OTHER])
        expect(fakeFs.listing('coldstorage')).toEqual([`${OTHER}.json`])
    })
})
