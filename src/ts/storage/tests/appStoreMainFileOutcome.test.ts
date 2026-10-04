/**
 * `readMainFile` and `writeMainFile` report to the main-file outcome tracking
 * synchronously around the store call, and `injectAppStore` starts it clean.
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

import { injectAppStore, readMainFile, writeMainFile } from '../store/appStore'
import { getMainFileEpoch, isMainFileOutcomeKnown, noteMainFileRecorded } from '../mainFileOutcome'

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

describe('writeMainFile reports its outcome', () => {
    test('is unknown while the store write is pending and known once it returns', async () => {
        let finish: () => void = () => {}
        injectAppStore(storeWith({ write: () => new Promise((resolve) => { finish = () => resolve({ version: null }) }) }))
        const pending = writeMainFile(new Uint8Array([1]))
        await Promise.resolve()
        await Promise.resolve()
        expect(isMainFileOutcomeKnown()).toBe(false)
        finish()
        await pending
        expect(isMainFileOutcomeKnown()).toBe(true)
    })

    test('a write that throws leaves the outcome unknown', async () => {
        injectAppStore(storeWith({ write: async () => { throw new Error('lost reply') } }))
        await expect(writeMainFile(new Uint8Array([1]))).rejects.toThrow('lost reply')
        expect(isMainFileOutcomeKnown()).toBe(false)
    })

    test('a later write that returns makes it known again', async () => {
        let fail = true
        injectAppStore(storeWith({ write: async () => { if (fail) throw new Error('lost reply'); return { version: null } } }))
        await expect(writeMainFile(new Uint8Array([1]))).rejects.toThrow()
        fail = false
        await writeMainFile(new Uint8Array([2]))
        expect(isMainFileOutcomeKnown()).toBe(true)
    })

    test('a write refused before it is sent is not an attempt', async () => {
        injectAppStore(storeWith({ capabilities: { conditionalWrites: true } }))
        const epoch = getMainFileEpoch()
        await expect(writeMainFile(new Uint8Array([1]))).rejects.toThrow()
        expect(getMainFileEpoch()).toBe(epoch)
        expect(isMainFileOutcomeKnown()).toBe(true)
    })

    test('the store write starts before any other task can run', async () => {
        let timerFired = false
        let firedAtWrite: boolean | null = null
        injectAppStore(storeWith({ write: async () => { firedAtWrite = timerFired; return { version: null } } }))
        setTimeout(() => { timerFired = true }, 0)
        await writeMainFile(new Uint8Array([1]))
        expect(firedAtWrite).toBe(false)
    })
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

    test('injecting a store forgets earlier attempts', async () => {
        injectAppStore(storeWith({ write: async () => { throw new Error('lost reply') } }))
        await expect(writeMainFile(new Uint8Array([1]))).rejects.toThrow()
        injectAppStore(storeWith({}))
        expect(isMainFileOutcomeKnown()).toBe(true)
    })
})
