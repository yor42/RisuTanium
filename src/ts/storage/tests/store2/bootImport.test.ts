// @vitest-environment node
/**
 * The boot-time import of a decoded legacy-shaped tree (`legacy/bootImport.ts`) over a store that has no `current`: the
 * first-life install of row 1 under a grant labelled `import`, and the fenced recovery exit. Driven over a memory backend
 * and a memory byte store holding old upstream and fork-format files, with the `.bin` goldens as the imported trees.
 * Labels in test names: `guard` may pass before and after a change, `new behaviour` asserts the rule of this module.
 */
import { describe, expect, test, vi } from 'vitest'
import type { ForageLike } from 'src/ts/storage/tests/forageBackedStore'

vi.mock('localforage', () => ({
    default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => { }), removeItem: vi.fn(async () => { }) }) },
}))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    forageStorage: { keys: vi.fn(async () => []), getItem: vi.fn(async () => null), setItem: vi.fn(async () => { }), removeItem: vi.fn(async () => { }) },
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/storage/store/appStore'), async () => {
    const { appStoreModuleOver } = await import('src/ts/storage/tests/appStoreMock')
    const { forageStorage } = await import('src/ts/globalApi.svelte')
    return appStoreModuleOver(() => forageStorage as unknown as ForageLike) as unknown as typeof import('src/ts/storage/store/appStore')
})
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({})),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/platform'), () => ({ isTauri: false, isNodeServer: true }))
vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 },
}))
// The page's unit naming reads the platform at load; this stands in for the browser and Node naming.
vi.mock('src/ts/process/coldUnitLocation', () => ({
    coldUnitKeyOfStoreKey: (key: string) => {
        const name = key.slice('coldstorage/'.length)
        return key.startsWith('coldstorage/') && !name.includes('/') ? name : null
    },
}))

import { createMemoryByteStore, type MemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import { createMemoryBackend, type MemoryBackend, type Store2Backend } from 'src/ts/storage/store2/backend'
import { classifyCommitRead } from 'src/ts/storage/store2/commitKey'
import { firstLifeGrant } from 'src/ts/storage/store2/firstLife'
import { COMMIT_KEY, keyOfRef, readUnit, UNIT_TYPE, type DeletionSnapshot, type Manifest } from 'src/ts/storage/store2/format'
import { bootImportLegacyTree, type BootImportRequest } from 'src/ts/storage/store2/legacy/bootImport'
import { freshOwnerId } from 'src/ts/storage/store2/owner'
import { readTreeBytes } from 'src/ts/storage/store2/treeBytes'
import { createClock as storeClock, testEnv as storeEnv } from '../store2SaveKit'
import { fakeLists } from './codecFixtures'
import { parsedCommit } from './commitFixtures'
import { loadGolden, readerOver } from './legacyFixtures'

const OPTIONS = { newId: () => 'placeholder-chat-id', now: () => 1_700_000_000_001 }
const accept = { async confirmIncomplete() { return true } }
const owner = freshOwnerId(storeEnv(storeClock(), 1))
const MAIN = 'database/database.bin'
const backupKey = (time: number) => `database/dbbackup-${time}.bin`

interface Rig {
    memory: MemoryBackend
    store: MemoryByteStore
    /** The commit key's staging label at each put, in order; null while no marker stands. */
    labelsAtPut: (string | null)[]
    backend: Store2Backend
    request(golden: Awaited<ReturnType<typeof loadGolden>>, entry?: BootImportRequest['entry']): Promise<BootImportRequest>
}

async function rig(options: { mainFile?: boolean, backups?: number[], fork?: boolean } = {}): Promise<Rig> {
    const memory = createMemoryBackend()
    const store = createMemoryByteStore()
    if (options.mainFile === true) {
        store.files.set(MAIN, new Uint8Array([1, 2, 3]))
    }
    for (const time of options.backups ?? []) {
        store.files.set(backupKey(time), new Uint8Array([1]))
    }
    if (options.fork === true) {
        for (const key of ['blocks/head', 'blocks/000000000001-aaaaaaaa/root', 'database/database.pre-blocks.1']) {
            store.files.set(key, new Uint8Array([1]))
        }
    }
    const labelsAtPut: (string | null)[] = []
    const backend: Store2Backend = {
        ...memory,
        async putUnit(key, bytes) {
            const parsed = classifyCommitRead(await memory.readCommit())
            labelsAtPut.push(parsed.status === 'parsed' && parsed.value.staging !== null ? parsed.value.staging.label : null)
            return memory.putUnit(key, bytes)
        },
    }
    return {
        memory, store, labelsAtPut, backend,
        async request(golden, entry) {
            const granted = firstLifeGrant({ decision: { row: 1, mode: 'first-life', action: 'seed' }, commitRead: await memory.readCommit(), startupClear: null }, { label: 'import' })
            if (granted.status !== 'granted') {
                throw new Error('No first-life grant.')
            }
            return {
                source: { tree: golden.tree },
                reader: readerOver(golden.units),
                backend,
                entry: entry ?? { kind: 'first-life', grant: granted.grant },
                owner,
                lists: fakeLists,
                env: storeEnv(storeClock(), 4242),
                resolve: OPTIONS,
                oldData: {
                    store,
                    listBackupTimes: async () => [...store.files.keys()]
                        .map(key => /^database\/dbbackup-(\d+)\.bin$/.exec(key))
                        .filter((match): match is RegExpExecArray => match !== null)
                        .map(match => Number(match[1]))
                        .sort((a, b) => b - a),
                },
                upstreamMainFile: async () => store.files.has(MAIN),
            }
        },
    }
}

async function currentManifest(memory: MemoryBackend): Promise<Manifest> {
    const key = (await parsedCommit(memory)).current
    if (key === null) {
        throw new Error('No manifest is current.')
    }
    const read = await readTreeBytes(memory, key.key)
    if (read.status !== 'ok') {
        throw new Error(`The stored tree reads ${read.status}.`)
    }
    return read.tree.manifest
}

describe('new behaviour: a boot import installs under a first-life marker labelled import (R5)', () => {
    test('the marker standing during every unit write is labelled import, no fence is written, and the key ends with a current and no marker', async () => {
        const w = await rig()
        const result = await bootImportLegacyTree(await w.request(await loadGolden('upstream-full.bin')), accept)
        expect(result.status).toBe('installed')
        expect(w.labelsAtPut.length).toBeGreaterThan(0)
        expect(new Set(w.labelsAtPut)).toEqual(new Set(['import']))
        expect((await w.memory.readFence()).bytes).toBeNull()
        const key = await parsedCommit(w.memory)
        expect(key.current).not.toBeNull()
        expect(key.staging).toBeNull()
        expect(key.convertedFrom).toBe('import')
        expect(w.memory.snapshot().has(COMMIT_KEY)).toBe(true)
    })

    test('a grant that is not labelled import is refused before anything is written', async () => {
        const w = await rig()
        const wrong = firstLifeGrant({ decision: { row: 1, mode: 'first-life', action: 'seed' }, commitRead: await w.memory.readCommit(), startupClear: null })
        if (wrong.status !== 'granted') {
            throw new Error('No first-life grant.')
        }
        const request = await w.request(await loadGolden('upstream-full.bin'), { kind: 'first-life', grant: wrong.grant })
        await expect(bootImportLegacyTree(request, accept)).rejects.toThrow(TypeError)
        expect(w.labelsAtPut).toEqual([])
        expect((await w.memory.readCommit()).bytes).toBeNull()
    })

    test('a decline of the incomplete-items question writes nothing', async () => {
        const w = await rig()
        const result = await bootImportLegacyTree(await w.request(await loadGolden('upstream-missing-unit.bin')), { async confirmIncomplete() { return false } })
        expect(result.status).toBe('declined')
        expect(w.labelsAtPut).toEqual([])
        expect((await w.memory.readCommit()).bytes).toBeNull()
    })

    test('the exit entry writes the fence first, then the marker labelled import, and installs', async () => {
        const w = await rig()
        const read = await w.memory.readCommit()
        const request = await w.request(await loadGolden('upstream-full.bin'), { kind: 'exit', commitRead: read })
        const result = await bootImportLegacyTree(request, accept)
        expect(result.status).toBe('installed')
        expect(new Set(w.labelsAtPut)).toEqual(new Set(['import']))
        expect((await w.memory.readFence()).bytes).not.toBeNull()
    })
})

describe('new behaviour: old upstream files the store still holds are kept, never read (B3-Q5)', () => {
    test('every old file is listed unreadable, the main file and each backup', async () => {
        const w = await rig({ mainFile: true, backups: [100, 200] })
        const result = await bootImportLegacyTree(await w.request(await loadGolden('upstream-full.bin')), accept)
        expect(result.status).toBe('installed')
        const keep = (await currentManifest(w.memory)).fixed.legacyKeep
        expect(keep).not.toBeNull()
        expect(Object.fromEntries((keep?.files ?? []).map(file => [file.key, file.status]))).toEqual({
            [MAIN]: 'unreadable',
            [backupKey(100)]: 'unreadable',
            [backupKey(200)]: 'unreadable',
        })
        const list = readUnit(w.memory.snapshot().get(keyOfRef(keep!.unit)) as Uint8Array, UNIT_TYPE.legacyList)
        expect(list.status).toBe('ok')
        expect(w.store.writes).toEqual([])
        expect(w.store.deletes).toEqual([])
    })

    test('numbered backups without a main file are listed too, and a store with no old file lists nothing', async () => {
        const only = await rig({ backups: [300] })
        expect((await bootImportLegacyTree(await only.request(await loadGolden('upstream-full.bin')), accept)).status).toBe('installed')
        expect((await currentManifest(only.memory)).fixed.legacyKeep?.files.map(file => file.key)).toEqual([backupKey(300)])

        const none = await rig()
        expect((await bootImportLegacyTree(await none.request(await loadGolden('upstream-full.bin')), accept)).status).toBe('installed')
        expect((await currentManifest(none.memory)).fixed.legacyKeep).toBeNull()
    })
})

describe('new behaviour: a first-life or exit import writes the deletion snapshot (type 24)', () => {
    test('a fork-block profile that imports gets a snapshot, written before the manifest and pointed at by the commit key', async () => {
        const w = await rig({ fork: true, mainFile: true })
        const result = await bootImportLegacyTree(await w.request(await loadGolden('upstream-full.bin')), accept)
        expect(result.status).toBe('installed')
        const key = await parsedCommit(w.memory)
        expect(key.snapshot, 'the commit key names a snapshot').toBeDefined()
        const bytes = w.memory.snapshot().get(key.snapshot!.key) as Uint8Array
        const read = readUnit(bytes, UNIT_TYPE.deletionSnapshot)
        expect(read.status).toBe('ok')
        const body = read.status === 'ok' ? read.value.body as DeletionSnapshot : null
        expect(body?.keys).toContain('blocks/head')
        expect(key.snapshot!.count).toBe(body?.keys.length)
    })

    test('the exit entry (the recovery screen) writes the snapshot too, pointed at by the commit key', async () => {
        const w = await rig({ fork: true, mainFile: true })
        const request = await w.request(await loadGolden('upstream-full.bin'), { kind: 'exit', commitRead: await w.memory.readCommit() })
        expect((await bootImportLegacyTree(request, accept)).status).toBe('installed')
        const key = await parsedCommit(w.memory)
        expect(key.snapshot, 'the commit key names a snapshot').toBeDefined()
        const read = readUnit(w.memory.snapshot().get(key.snapshot!.key) as Uint8Array, UNIT_TYPE.deletionSnapshot)
        expect(read.status).toBe('ok')
        const body = read.status === 'ok' ? read.value.body as DeletionSnapshot : null
        expect(body?.keys).toContain('blocks/head')
    })

    test('guard: a store with no fork-format file installs without a snapshot', async () => {
        const w = await rig({ mainFile: true })
        expect((await bootImportLegacyTree(await w.request(await loadGolden('upstream-full.bin')), accept)).status).toBe('installed')
        expect((await parsedCommit(w.memory)).snapshot).toBeUndefined()
    })
})
