/**
 * `readMainFile` reports to the main-file outcome tracking when the store call
 * returns, and `injectAppStore` starts it clean.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ByteStore } from '../store/contract'

vi.mock('localforage', () => ({
    default: { supports: () => true, INDEXEDDB: 'asyncStorage', createInstance: () => ({ ready: async () => {} }) },
}))
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'linux' }))
vi.mock('@tauri-apps/plugin-fs', () => ({ BaseDirectory: { AppData: 0 } }))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    acquireExclusiveStorageMigrationLock: vi.fn(),
    forageStorage: {},
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/platform'), () => ({ isTauri: false, isNodeServer: false }))
vi.mock('src/lang', () => ({ language: {} }))
vi.mock('src/ts/util', () => ({
    asBuffer: (value: Uint8Array) => value,
    base64url: (source: Uint8Array | ArrayBuffer) => Buffer.from(source as Uint8Array).toString('base64url'),
    getKeypairStore: vi.fn(),
    saveKeypairStore: vi.fn(),
}))
vi.mock('src/ts/alert', () => ({
    alertError: vi.fn(),
    alertInput: vi.fn(),
    waitAlert: vi.fn(async () => { }),
}))

import { injectAppStore, readMainFile } from '../store/appStore'
import { isMainFileOutcomeKnown, noteMainFileRecorded } from '../mainFileOutcome'

function storeWith(overrides: Partial<ByteStore>): ByteStore {
    return {
        capabilities: { conditionalWrites: false },
        read: async () => ({ bytes: new Uint8Array([1]), version: null }),
        write: async () => ({ version: null }),
        delete: async () => {},
        deleteMany: async () => {},
        list: async () => [],
        has: async () => true,
        ...overrides,
    }
}

beforeEach(() => {
    injectAppStore(storeWith({}))
})

describe('readMainFile reports its outcome', () => {
    test('a read is known once its bytes are recorded, and a failed read changes nothing', async () => {
        await readMainFile()
        expect(isMainFileOutcomeKnown()).toBe(false)
        noteMainFileRecorded()
        expect(isMainFileOutcomeKnown()).toBe(true)

        injectAppStore(storeWith({ read: async () => { throw new Error('read failed') } }))
        await expect(readMainFile()).rejects.toThrow('read failed')
        expect(isMainFileOutcomeKnown()).toBe(true)
    })

    test('injecting a store forgets an earlier unrecorded read', async () => {
        await readMainFile()
        expect(isMainFileOutcomeKnown()).toBe(false)
        injectAppStore(storeWith({}))
        expect(isMainFileOutcomeKnown()).toBe(true)
    })
})
