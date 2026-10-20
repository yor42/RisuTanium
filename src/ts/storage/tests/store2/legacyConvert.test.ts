// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { createMemoryByteStore, type MemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import { coldStorageHeader } from 'src/ts/process/coldstorageData'
import type { Database } from 'src/ts/storage/database.svelte'
import { fingerprintMainFile } from 'src/ts/storage/mainFileFingerprint'
import { createMemoryBackend, Store2BackendFailureError, type MemoryBackend, type Store2Backend } from 'src/ts/storage/store2/backend'
import { classifyBoot, runBootClear } from 'src/ts/storage/store2/boot'
import { assembleDatabase } from 'src/ts/storage/store2/codec'
import { firstLifeGrant } from 'src/ts/storage/store2/firstLife'
import { classifyCommitRead } from 'src/ts/storage/store2/commitKey'
import { keyOfRef, readUnit, UNIT_TYPE, type KeyEnv, type LegacyList, type Manifest } from 'src/ts/storage/store2/format'
import {
    convertLegacyProfile, convertLegacyWithout, type ConvertRequest, type ConvertResult, type LegacyDecoders,
} from 'src/ts/storage/store2/legacy/convert'
import type { SkippedLegacyEntry } from 'src/ts/storage/store2/legacy/lenient'
import { resolveLegacyTree, type IncompleteItem } from 'src/ts/storage/store2/legacy/resolve'
import { createLegacyStoreReader, type ColdUnitRead } from 'src/ts/storage/store2/legacy/storeReader'
import { readTreeBytes } from 'src/ts/storage/store2/treeBytes'
import { freshOwnerId } from 'src/ts/storage/store2/owner'
import { createClock, testEnv } from '../store2SaveKit'
import { buildSmall, fakeLists, type Obj } from './codecFixtures'
import { committerOf } from './commitFixtures'
import { inlayToken, UUID_A, UUID_B } from './listsFixtures'
import { encodeAndAssemble, ID, readerOver, type StoredUnit } from './legacyFixtures'

/**
 * The conversion of a legacy profile (`legacy/convert.ts`), driven over a memory backend and a recording byte store with
 * injected decoders: every file decodes to a tree the test names, so the strict, backup and lenient paths are exercised
 * without a real save file. Labels: new behaviour.
 */

const MAIN = 'database/database.bin'
const backupKey = (time: number) => `database/dbbackup-${time}.bin`
const NOW = () => 1

const CHAT_UNIT = '00000000-0000-4000-8000-0000000000c1'
const OTHER_UNIT = '00000000-0000-4000-8000-0000000000c2'
const THIRD_UNIT = '00000000-0000-4000-8000-0000000000c3'

type Tree = Database

/** A small library whose first character has a picture and a chat that lives in the cold unit `unit`. */
function treeWithColdChat(unit: string, picture = 'Pic.PNG'): Tree {
    const tree = JSON.parse(JSON.stringify(buildSmall(1))) as { characters: Obj[] }
    const first = tree.characters[0]
    first.image = picture
    first.chats = [{ id: 'cold-chat', message: [{ time: 1, data: coldStorageHeader + unit, role: 'char' }], note: '', name: '', localLore: [] }]
    return tree as unknown as Tree
}

function chatUnit(text: string): StoredUnit {
    return { status: 'ok', value: { message: [{ time: 1, data: text, role: 'char' }] } }
}

interface Faults {
    errorKeys?: ReadonlySet<string>
    damagedKeys?: ReadonlySet<string>
}

interface Rig {
    store: MemoryByteStore
    memory: MemoryBackend
    log: string[]
    request: ConvertRequest
    grantOwner: string
}

interface RigOptions {
    /** First byte of a file to the tree it decodes to; absent or `'bad'` does not decode. */
    trees: Record<number, Tree | 'bad'>
    /** Numbered backups, as time to first byte. */
    backups?: Record<number, number>
    mainByte?: number
    units?: ReadonlyMap<string, StoredUnit>
    faults?: Faults
    lenient?: { tree: Tree, skipped: SkippedLegacyEntry[] }
    /** First bytes of files whose strict decode fails because the store cannot be read (`RisuSaveReadError`). */
    readErrorBytes?: number[]
    /** First bytes of files whose strict decode fails on a remote file the store cannot hand out as bytes (a deterministic failure). */
    notBinaryBytes?: number[]
    env?: KeyEnv
}

async function rig(options: RigOptions): Promise<Rig> {
    const store = createMemoryByteStore()
    const log: string[] = []
    if (options.mainByte !== undefined) {
        store.files.set(MAIN, new Uint8Array([options.mainByte, 2, 3]))
    }
    for (const [time, byte] of Object.entries(options.backups ?? {})) {
        store.files.set(backupKey(Number(time)), new Uint8Array([byte]))
    }
    const decoders: LegacyDecoders = {
        async strict(bytes) {
            log.push(`decode:${bytes[0]}`)
            if (options.readErrorBytes?.includes(bytes[0])) {
                throw Object.assign(new Error('the disk failed'), { name: 'RisuSaveReadError' })
            }
            if (options.notBinaryBytes?.includes(bytes[0])) {
                throw Object.assign(new Error('not binary data'), { name: 'RisuSaveReadError', cause: Object.assign(new Error('not binary data'), { name: 'StoreNotBinaryError' }) })
            }
            const entry = options.trees[bytes[0]]
            if (entry === undefined || entry === 'bad') {
                throw new Error('The file does not decode.')
            }
            return JSON.parse(JSON.stringify(entry)) as Tree
        },
        async lenient(bytes) {
            log.push(`lenient:${bytes[0]}`)
            if (options.lenient === undefined) {
                throw new Error('The file does not decode, even leniently.')
            }
            return { tree: JSON.parse(JSON.stringify(options.lenient.tree)) as Tree, skipped: options.lenient.skipped }
        },
    }
    const memory = createMemoryBackend()
    const units = options.units ?? new Map<string, StoredUnit>()
    const readColdStorageItem = async (key: string): Promise<ColdUnitRead> => {
        log.push(`read:${key}`)
        if (options.faults?.errorKeys?.has(key)) {
            return { status: 'error', error: new Error(`disk failure for ${key}`) }
        }
        if (options.faults?.damagedKeys?.has(key)) {
            return { status: 'error', error: new Error(`${key} is not JSON`), kind: 'damaged' }
        }
        const unit = units.get(key)
        if (unit === undefined) {
            return { status: 'missing' }
        }
        return unit.status === 'ok' ? { status: 'ok', value: unit.value } : { status: 'error', error: new Error('bad json'), kind: 'damaged' }
    }
    const granted = firstLifeGrant({ decision: { row: 1, mode: 'first-life', action: 'convert' }, commitRead: await memory.readCommit(), startupClear: null })
    if (granted.status !== 'granted') {
        throw new Error('No first-life grant.')
    }
    const env = options.env ?? testEnv(createClock(), 4242)
    const owner = freshOwnerId(testEnv(createClock(), 1))
    return {
        store,
        memory,
        log,
        grantOwner: owner,
        request: {
            store,
            listBackupTimes: async () => [...store.files.keys()]
                .map(key => /^database\/dbbackup-(\d+)\.bin$/.exec(key))
                .filter((match): match is RegExpExecArray => match !== null)
                .map(match => Number(match[1]))
                .sort((a, b) => b - a),
            readColdStorageItem,
            backend: memory,
            entry: { kind: 'first-life', grant: granted.grant },
            owner,
            lists: fakeLists,
            env,
            decoders,
            resolve: { newId: () => 'placeholder-chat', now: NOW },
        },
    }
}

const accept = {
    async confirmFromBackup() { return true },
    async confirmIncomplete() { return true },
    async confirmSkipped() { return true },
}

async function commitKeyOf(memory: MemoryBackend) {
    const read = classifyCommitRead(await memory.readCommit())
    if (read.status !== 'parsed') {
        throw new Error(`The commit key is ${read.status}.`)
    }
    return read.value
}

async function storedTree(memory: MemoryBackend) {
    const key = (await commitKeyOf(memory)).current
    if (key === null) {
        throw new Error('No manifest is current.')
    }
    const read = await readTreeBytes(memory, key.key)
    if (read.status !== 'ok') {
        throw new Error(`The stored tree reads ${read.status}.`)
    }
    return read.tree
}

async function storedLegacyKeep(memory: MemoryBackend): Promise<{ keep: NonNullable<Manifest['fixed']['legacyKeep']>, list: LegacyList }> {
    const tree = await storedTree(memory)
    const keep = tree.manifest.fixed.legacyKeep
    if (keep === null) {
        throw new Error('The manifest names no legacy list.')
    }
    const parsed = readUnit(memory.snapshot().get(keyOfRef(keep.unit)) as Uint8Array, UNIT_TYPE.legacyList)
    if (parsed.status !== 'ok') {
        throw new Error('The legacy list does not parse.')
    }
    return { keep, list: parsed.value.body as LegacyList }
}

function statusOf(files: readonly { key: string, status: string }[]): Record<string, string> {
    return Object.fromEntries(files.map(file => [file.key, file.status]))
}

function installed(result: ConvertResult): Extract<ConvertResult, { status: 'installed' }> {
    expect(result.status).toBe('installed')
    if (result.status !== 'installed') {
        throw new Error(`The conversion answered ${result.status}.`)
    }
    return result
}

describe('new behaviour: a strict conversion', () => {
    const units = new Map<string, StoredUnit>([[CHAT_UNIT, chatUnit(`restored ${inlayToken(UUID_A)}`)]])

    test('the stored tree is the encoding of the resolved legacy tree, and the old files are untouched', async () => {
        const tree = treeWithColdChat(CHAT_UNIT)
        const env = testEnv(createClock(), 4242)
        const test = await rig({ trees: { 1: tree }, mainByte: 1, units, env })
        const before = new Map(test.store.files)

        const result = installed(await convertLegacyProfile(test.request, accept))

        const stored = await storedTree(test.memory)
        const assembled = assembleDatabase(stored.manifest, stored.source) as unknown as { characters: { chats: { message: { data: string }[] }[] }[] }
        expect(assembled.characters[0].chats[0].message[0].data).toBe(`restored ${inlayToken(UUID_A)}`)
        const resolved = await resolveLegacyTree(tree, createLegacyStoreReader(test.request.readColdStorageItem), { newId: () => 'placeholder-chat', now: NOW })
        const expected = encodeAndAssemble(resolved.database, 3).assembled
        expect(JSON.parse(JSON.stringify(assembled.characters.map(character => character.chats)))).toEqual(
            JSON.parse(JSON.stringify((expected as unknown as typeof assembled).characters.map(character => character.chats))),
        )
        expect(result.fromBackup).toBeNull()
        expect(new Map(test.store.files)).toEqual(before)
        expect(test.store.writes).toEqual([])
        expect(test.store.deletes).toEqual([])
    })

    test('the manifest names the legacy list, the files it covers and the file it was converted from', async () => {
        const mainBytes = new Uint8Array([1, 2, 3])
        const test = await rig({ trees: { 1: treeWithColdChat(CHAT_UNIT), 2: treeWithColdChat(OTHER_UNIT, 'Back.GIF') }, mainByte: 1, backups: { 100: 2 }, units: new Map([...units, [OTHER_UNIT, chatUnit(`backup ${inlayToken(UUID_B)}`)]]) })

        installed(await convertLegacyProfile(test.request, accept))

        const { keep, list } = await storedLegacyKeep(test.memory)
        expect((await commitKeyOf(test.memory)).convertedFrom).toBe(fingerprintMainFile(mainBytes))
        expect(statusOf(keep.files)).toEqual({ [MAIN]: 'ok', [backupKey(100)]: 'ok' })
        expect(statusOf(list.files)).toEqual({ [MAIN]: 'ok', [backupKey(100)]: 'ok' })
        expect(keep.v).toBe(list.v)
        expect(list.l).toEqual(expect.arrayContaining(['back.gif', 'pic.png']))
        expect(list.i.u).toEqual(expect.arrayContaining([UUID_A, UUID_B]))
    })

    test('nothing is written before the marker: the question about what is missing is asked with the store untouched', async () => {
        const test = await rig({ trees: { 1: treeWithColdChat(CHAT_UNIT) }, mainByte: 1 })
        let atPrompt: { snapshot: number, commit: Uint8Array | null } | null = null

        const result = await convertLegacyProfile(test.request, {
            ...accept,
            async confirmIncomplete() {
                atPrompt = { snapshot: test.memory.snapshot().size, commit: (await test.memory.readCommit()).bytes }
                return true
            },
        })

        expect(result.status).toBe('installed')
        expect(atPrompt).toEqual({ snapshot: 0, commit: null })
    })

    test('declining what is missing writes nothing at all', async () => {
        const test = await rig({ trees: { 1: treeWithColdChat(CHAT_UNIT) }, mainByte: 1 })
        const asked: IncompleteItem[][] = []

        const result = await convertLegacyProfile(test.request, { ...accept, async confirmIncomplete(items) { asked.push([...items]); return false } })

        expect(result).toEqual({ status: 'declined' })
        expect(asked).toHaveLength(1)
        expect(asked[0]).toEqual([expect.objectContaining({ kind: 'chat', key: CHAT_UNIT, reason: 'missing' })])
        expect(test.memory.snapshot().size).toBe(0)
        expect((await test.memory.readCommit()).bytes).toBeNull()
        expect(test.store.writes).toEqual([])
        expect(test.store.deletes).toEqual([])
    })

    test('nothing is asked when nothing is missing', async () => {
        const test = await rig({ trees: { 1: treeWithColdChat(CHAT_UNIT) }, mainByte: 1, units })
        let asked = 0

        installed(await convertLegacyProfile(test.request, { ...accept, async confirmIncomplete() { asked += 1; return false } }))

        expect(asked).toBe(0)
    })

    test('a cold unit that cannot be read aborts before any write, and is not taken for a missing one', async () => {
        const test = await rig({ trees: { 1: treeWithColdChat(CHAT_UNIT) }, mainByte: 1, units, faults: { errorKeys: new Set([CHAT_UNIT]) } })

        const result = await convertLegacyProfile(test.request, accept)

        expect(result).toEqual({ status: 'blocked', reason: 'convert-read-failed', detail: expect.stringContaining(CHAT_UNIT) })
        expect(test.memory.snapshot().size).toBe(0)
        expect((await test.memory.readCommit()).bytes).toBeNull()
    })
})

describe('new behaviour: a main file that does not decode strictly', () => {
    test('the newest numbered backup that decodes is converted, named, and the main file is listed unreadable', async () => {
        const test = await rig({
            trees: { 1: 'bad', 9: 'bad', 8: treeWithColdChat(CHAT_UNIT) },
            mainByte: 1,
            backups: { 100: 8, 200: 8, 300: 9 },
            units: new Map([[CHAT_UNIT, chatUnit('from a backup')]]),
        })

        const result = installed(await convertLegacyProfile(test.request, accept))

        expect(result.fromBackup).toBe(200)
        expect((await commitKeyOf(test.memory)).convertedFrom).toBe(fingerprintMainFile(new Uint8Array([8])))
        const { keep } = await storedLegacyKeep(test.memory)
        expect(statusOf(keep.files)).toEqual({ [MAIN]: 'unreadable', [backupKey(100)]: 'ok', [backupKey(200)]: 'ok', [backupKey(300)]: 'unreadable' })
        expect(test.store.writes).toEqual([])
        expect(test.store.deletes).toEqual([])
    })

    test('a main file that is absent is a failed strict decode, not an error', async () => {
        const test = await rig({ trees: { 8: treeWithColdChat(CHAT_UNIT) }, backups: { 100: 8 }, units: new Map([[CHAT_UNIT, chatUnit('x')]]) })

        const result = installed(await convertLegacyProfile(test.request, accept))

        expect(result.fromBackup).toBe(100)
    })

    test('a main file the store holds but cannot hand out as bytes is a failed strict decode too', async () => {
        const test = await rig({ trees: { 8: treeWithColdChat(CHAT_UNIT) }, mainByte: 1, backups: { 100: 8 }, units: new Map([[CHAT_UNIT, chatUnit('x')]]) })
        const read = test.store.read.bind(test.store)
        test.store.read = async (key) => {
            if (key === MAIN) {
                const { StoreNotBinaryError } = await import('src/ts/storage/store/errors')
                throw new StoreNotBinaryError(key)
            }
            return read(key)
        }

        const result = installed(await convertLegacyProfile(test.request, accept))

        expect(result.fromBackup).toBe(100)
    })

    test('when the main file and every backup fail, nothing is converted or written and the backups tried are named', async () => {
        const test = await rig({ trees: { 1: 'bad' }, mainByte: 1, backups: { 100: 1, 200: 1 } })

        const result = await convertLegacyProfile(test.request, accept)

        expect(result).toEqual({ status: 'all-failed', backupsTried: [200, 100] })
        expect(test.memory.snapshot().size).toBe(0)
        expect((await test.memory.readCommit()).bytes).toBeNull()
    })

    test('the strict decode is the one used: a file only the lenient decode reads is not converted by the default path', async () => {
        const test = await rig({ trees: { 1: 'bad' }, mainByte: 1, lenient: { tree: treeWithColdChat(CHAT_UNIT), skipped: [] } })

        const result = await convertLegacyProfile(test.request, accept)

        expect(result.status).toBe('all-failed')
        expect(test.log.filter(entry => entry.startsWith('lenient'))).toEqual([])
    })
})

describe('new behaviour: converting from a numbered backup is asked first', () => {
    const units = new Map<string, StoredUnit>([[CHAT_UNIT, chatUnit('x')]])

    test('the prompt names the backup time and comes before the incomplete-data question and before any write', async () => {
        const test = await rig({ trees: { 1: 'bad', 8: treeWithColdChat(CHAT_UNIT) }, mainByte: 1, backups: { 100: 8, 200: 8 } })
        const order: string[] = []
        let writtenAtPrompt = -1

        const result = await convertLegacyProfile(test.request, {
            async confirmFromBackup(backup) {
                order.push(`backup:${backup}`)
                writtenAtPrompt = test.memory.snapshot().size
                return true
            },
            async confirmIncomplete() {
                order.push('incomplete')
                return true
            },
        })

        expect(result.status).toBe('installed')
        expect(order).toEqual(['backup:200', 'incomplete'])
        expect(writtenAtPrompt).toBe(0)
    })

    test('declining writes nothing and leaves every old file as it was', async () => {
        const test = await rig({ trees: { 1: 'bad', 8: treeWithColdChat(CHAT_UNIT) }, mainByte: 1, backups: { 100: 8 }, units })
        const before = new Map(test.store.files)
        let incomplete = 0

        const result = await convertLegacyProfile(test.request, { async confirmFromBackup() { return false }, async confirmIncomplete() { incomplete += 1; return true } })

        expect(result).toEqual({ status: 'declined' })
        expect(incomplete).toBe(0)
        expect(test.memory.snapshot().size).toBe(0)
        expect((await test.memory.readCommit()).bytes).toBeNull()
        expect(new Map(test.store.files)).toEqual(before)
    })

    test('a main file that decodes strictly never asks', async () => {
        const test = await rig({ trees: { 1: treeWithColdChat(CHAT_UNIT) }, mainByte: 1, backups: { 100: 1 }, units })
        let asked = 0

        installed(await convertLegacyProfile(test.request, { ...accept, async confirmFromBackup() { asked += 1; return false } }))

        expect(asked).toBe(0)
    })

    test('the backup is decoded once for the conversion: the list phase decodes the others, and the chosen one again only as a listed file', async () => {
        const test = await rig({ trees: { 1: 'bad', 8: treeWithColdChat(CHAT_UNIT) }, mainByte: 1, backups: { 100: 8 }, units })

        installed(await convertLegacyProfile(test.request, accept))

        // One decode in the choice of the source and one in the list phase, where it is a listed file; none for the question.
        expect(test.log.filter(entry => entry === 'decode:8')).toHaveLength(2)
    })
})

describe('new behaviour: a storage read failure is not a decode failure', () => {
    const units = new Map<string, StoredUnit>([[CHAT_UNIT, chatUnit('x')]])

    function recordReads(store: MemoryByteStore, failing?: string): string[] {
        const reads: string[] = []
        const read = store.read.bind(store)
        store.read = async (key) => {
            reads.push(key)
            if (key === failing) {
                throw new Error('the backup could not be read')
            }
            return read(key)
        }
        return reads
    }

    test('a main file whose decode cannot read the store blocks the conversion: nothing is written and no backup is read or tried', async () => {
        const test = await rig({ trees: { 8: treeWithColdChat(CHAT_UNIT) }, mainByte: 1, backups: { 100: 8 }, units, readErrorBytes: [1] })
        const reads = recordReads(test.store)

        const result = await convertLegacyProfile(test.request, accept)

        expect(result).toEqual({ status: 'blocked', reason: 'convert-read-failed', detail: 'the disk failed' })
        expect(reads).toEqual([MAIN])
        expect(test.log.filter(entry => entry.startsWith('decode'))).toEqual(['decode:1'])
        expect(test.memory.snapshot().size).toBe(0)
        expect((await test.memory.readCommit()).bytes).toBeNull()
        expect(test.store.writes).toEqual([])
    })

    test('a main file whose remote block the store cannot hand out as bytes counts as a decode failure: the backup fallback goes on', async () => {
        const test = await rig({ trees: { 8: treeWithColdChat(CHAT_UNIT) }, mainByte: 1, backups: { 100: 8 }, units, notBinaryBytes: [1] })

        const result = installed(await convertLegacyProfile(test.request, accept))

        expect(result.fromBackup).toBe(100)
        expect(test.log.filter(entry => entry.startsWith('decode'))).toEqual(['decode:1', 'decode:8', 'decode:8'])
    })

    test('a numbered backup that cannot be read blocks the fallback and no older backup is tried', async () => {
        const test = await rig({ trees: { 1: 'bad', 9: 'bad', 8: treeWithColdChat(CHAT_UNIT) }, mainByte: 1, backups: { 100: 8, 200: 8, 300: 9 }, units })
        const reads = recordReads(test.store, backupKey(200))

        const result = await convertLegacyProfile(test.request, accept)

        expect(result).toEqual({ status: 'blocked', reason: 'convert-read-failed', detail: 'the backup could not be read' })
        expect(reads).toEqual([MAIN, backupKey(300), backupKey(200)])
        expect(test.memory.snapshot().size).toBe(0)
        expect((await test.memory.readCommit()).bytes).toBeNull()
    })

    test('a numbered backup whose decode cannot read the store blocks the fallback too', async () => {
        const test = await rig({ trees: { 1: 'bad', 8: treeWithColdChat(CHAT_UNIT) }, mainByte: 1, backups: { 100: 8, 300: 7 }, units, readErrorBytes: [7] })

        const result = await convertLegacyProfile(test.request, accept)

        expect(result).toEqual({ status: 'blocked', reason: 'convert-read-failed', detail: 'the disk failed' })
        expect(test.log.filter(entry => entry.startsWith('decode'))).toEqual(['decode:1', 'decode:7'])
        expect(test.memory.snapshot().size).toBe(0)
    })

    test('in the list phase a backup that cannot be read is listed unreadable and the conversion completes (unchanged)', async () => {
        const test = await rig({ trees: { 1: treeWithColdChat(CHAT_UNIT) }, mainByte: 1, backups: { 100: 1 }, units })
        recordReads(test.store, backupKey(100))

        installed(await convertLegacyProfile(test.request, accept))

        const { keep } = await storedLegacyKeep(test.memory)
        expect(statusOf(keep.files)).toEqual({ [MAIN]: 'ok', [backupKey(100)]: 'unreadable' })
    })

    test('in the list phase a backup whose decode cannot read the store is listed unreadable too (unchanged)', async () => {
        const test = await rig({ trees: { 1: treeWithColdChat(CHAT_UNIT) }, mainByte: 1, backups: { 100: 7 }, units, readErrorBytes: [7] })

        installed(await convertLegacyProfile(test.request, accept))

        const { keep } = await storedLegacyKeep(test.memory)
        expect(statusOf(keep.files)).toEqual({ [MAIN]: 'ok', [backupKey(100)]: 'unreadable' })
    })
})

describe('new behaviour: the old files are listed one at a time', () => {
    test('a backup that does not decode, or whose cold chain cannot be walked, is listed unreadable and the conversion completes', async () => {
        const test = await rig({
            trees: { 1: treeWithColdChat(CHAT_UNIT), 2: treeWithColdChat(OTHER_UNIT), 3: 'bad' },
            mainByte: 1,
            backups: { 100: 2, 200: 3, 300: 1 },
            units: new Map([[CHAT_UNIT, chatUnit('main')], [OTHER_UNIT, chatUnit('walk fails')]]),
            faults: { errorKeys: new Set<string>() },
        })
        // Only the walk of backup 100 fails: its unit holds text that is not JSON when the walk reads it.
        const original = test.request.readColdStorageItem
        let reads = 0
        test.request.readColdStorageItem = async (key) => {
            if (key === OTHER_UNIT) {
                reads += 1
                return { status: 'error', error: new Error('not JSON'), kind: 'damaged' }
            }
            return original(key)
        }

        const result = installed(await convertLegacyProfile(test.request, accept))

        expect(result.fromBackup).toBeNull()
        expect(reads).toBeGreaterThan(0)
        const { keep, list } = await storedLegacyKeep(test.memory)
        expect(statusOf(keep.files)).toEqual({ [MAIN]: 'ok', [backupKey(100)]: 'unreadable', [backupKey(200)]: 'unreadable', [backupKey(300)]: 'ok' })
        expect(statusOf(list.files)).toEqual(statusOf(keep.files))
    })

    test('a backup listing that fails after the questions blocks before the marker', async () => {
        const test = await rig({ trees: { 1: treeWithColdChat(CHAT_UNIT) }, mainByte: 1, units: new Map([[CHAT_UNIT, chatUnit('x')]]) })
        let calls = 0
        test.request.listBackupTimes = async () => {
            calls += 1
            throw new Error('the listing failed')
        }

        const result = await convertLegacyProfile(test.request, accept)

        // The main file decodes, so the first listing is the list builder's.
        expect(calls).toBe(1)
        expect(result).toEqual({ status: 'blocked', reason: 'backups-unlistable', detail: 'the listing failed' })
        expect(test.memory.snapshot().size).toBe(0)
        expect((await test.memory.readCommit()).bytes).toBeNull()
    })

    test('a plugin value is scanned for inlay ids, and a plugin value that is not JSON lists its file unreadable', async () => {
        const base = JSON.parse(JSON.stringify(buildSmall(1))) as { pluginCustomStorage: Record<string, unknown> }
        base.pluginCustomStorage = { _coldplugin: { slot: ID.pluginUnit } }
        const readable = await rig({
            trees: { 1: base as unknown as Tree },
            mainByte: 1,
            units: new Map([[ID.pluginUnit, { status: 'ok', value: { note: inlayToken(UUID_B) } }]]),
        })
        installed(await convertLegacyProfile(readable.request, accept))
        const first = await storedLegacyKeep(readable.memory)
        expect(first.list.i.u).toContain(UUID_B)
        expect(statusOf(first.list.files)).toEqual({ [MAIN]: 'ok' })

        const broken = await rig({
            trees: { 1: base as unknown as Tree },
            mainByte: 1,
            units: new Map([[ID.pluginUnit, { status: 'ok', value: {} }]]),
            faults: { damagedKeys: new Set([ID.pluginUnit]) },
        })
        installed(await convertLegacyProfile(broken.request, accept))
        const second = await storedLegacyKeep(broken.memory)
        expect(statusOf(second.list.files)).toEqual({ [MAIN]: 'unreadable' })
    })

    describe('upstream plugin storage index values are scanned like plugin units', () => {
        const INDEX = '00000000-0000-4000-8000-0000000000e1'
        const LARGE = '00000000-0000-4000-8000-0000000000e2'
        const withPointer = (): Tree => {
            const base = JSON.parse(JSON.stringify(buildSmall(1))) as { pluginCustomStorage: Record<string, unknown> }
            base.pluginCustomStorage = { _coldpluginIndex: INDEX }
            return base as unknown as Tree
        }
        const indexOf = (entries: unknown[]): StoredUnit => ({ status: 'ok', value: { type: 'risu-plugin-storage-index', version: 1, entries, trash: [] } })

        test('reproducer: an inlay referenced only by a small value and one referenced only by a large unit both stay in the list', async () => {
            const test = await rig({
                trees: { 1: withPointer() },
                mainByte: 1,
                units: new Map<string, StoredUnit>([
                    [INDEX, indexOf([{ k: 'small', s: JSON.stringify({ note: inlayToken(UUID_A) }) }, { k: 'big', l: LARGE }])],
                    [LARGE, { status: 'ok', value: { note: inlayToken(UUID_B) } }],
                ]),
            })

            installed(await convertLegacyProfile(test.request, accept))

            const { list } = await storedLegacyKeep(test.memory)
            expect(statusOf(list.files)).toEqual({ [MAIN]: 'ok' })
            expect(list.i.u).toEqual(expect.arrayContaining([UUID_A, UUID_B]))
        })

        test('reproducer: a small value that is not JSON, or a large unit that is not JSON, lists the file unreadable', async () => {
            const smallBad = await rig({
                trees: { 1: withPointer() },
                mainByte: 1,
                units: new Map<string, StoredUnit>([[INDEX, indexOf([{ k: 'small', s: '{not json' }])]]),
            })
            installed(await convertLegacyProfile(smallBad.request, accept))
            expect(statusOf((await storedLegacyKeep(smallBad.memory)).list.files)).toEqual({ [MAIN]: 'unreadable' })

            const largeBad = await rig({
                trees: { 1: withPointer() },
                mainByte: 1,
                units: new Map<string, StoredUnit>([[INDEX, indexOf([{ k: 'big', l: LARGE }])], [LARGE, { status: 'ok', value: {} }]]),
                faults: { damagedKeys: new Set([LARGE]) },
            })
            installed(await convertLegacyProfile(largeBad.request, accept))
            expect(statusOf((await storedLegacyKeep(largeBad.memory)).list.files)).toEqual({ [MAIN]: 'unreadable' })
        })

        test('reproducer: an absent index unit lists the file unreadable, because the units it names are unknown', async () => {
            const test = await rig({ trees: { 1: withPointer() }, mainByte: 1, units: new Map<string, StoredUnit>() })

            installed(await convertLegacyProfile(test.request, accept))

            expect(statusOf((await storedLegacyKeep(test.memory)).list.files)).toEqual({ [MAIN]: 'unreadable' })
        })

        test('guard: a large unit that is absent is skipped and the file stays readable', async () => {
            const test = await rig({
                trees: { 1: withPointer() },
                mainByte: 1,
                units: new Map<string, StoredUnit>([[INDEX, indexOf([{ k: 'big', l: LARGE }])]]),
            })

            installed(await convertLegacyProfile(test.request, accept))

            expect(statusOf((await storedLegacyKeep(test.memory)).list.files)).toEqual({ [MAIN]: 'ok' })
        })
    })

    test('old files are decoded and scanned in turn: a backup is not decoded until the one before it has been read to its end', async () => {
        const test = await rig({
            trees: { 1: treeWithColdChat(CHAT_UNIT), 2: treeWithColdChat(OTHER_UNIT), 3: treeWithColdChat(THIRD_UNIT) },
            mainByte: 1,
            backups: { 100: 2, 200: 3 },
            units: new Map([[CHAT_UNIT, chatUnit('a')], [OTHER_UNIT, chatUnit('b')], [THIRD_UNIT, chatUnit('c')]]),
        })

        installed(await convertLegacyProfile(test.request, accept))

        const first = test.log.indexOf('decode:3')
        expect(first).toBeGreaterThan(0)
        expect(test.log.slice(first)).toEqual(['decode:3', `read:${THIRD_UNIT}`, 'decode:2', `read:${OTHER_UNIT}`])
    })
})

describe('new behaviour: "convert without these"', () => {
    const skipped: SkippedLegacyEntry[] = [
        { name: 'cha-lost-1', kind: 'character', reason: 'block is missing' },
        { name: 'cha-lost-2', kind: 'character', reason: 'block is damaged' },
    ]

    test('each skipped block is named before the marker; the main file is listed unreadable; the old files are untouched', async () => {
        const test = await rig({
            trees: { 8: treeWithColdChat(CHAT_UNIT) },
            mainByte: 1,
            backups: { 100: 8 },
            units: new Map([[CHAT_UNIT, chatUnit('kept')]]),
            lenient: { tree: treeWithColdChat(CHAT_UNIT), skipped },
        })
        const named: (readonly SkippedLegacyEntry[])[] = []
        const before = new Map(test.store.files)
        let snapshotAtQuestion = -1

        const result = installed(await convertLegacyWithout(test.request, {
            async confirmIncomplete() { return true },
            async confirmSkipped(entries) {
                named.push(entries)
                snapshotAtQuestion = test.memory.snapshot().size
                return true
            },
        }))

        expect(named).toEqual([skipped])
        expect(snapshotAtQuestion).toBe(0)
        expect(result.fromBackup).toBeNull()
        expect((await commitKeyOf(test.memory)).convertedFrom).toBe(fingerprintMainFile(new Uint8Array([1, 2, 3])))
        const { keep } = await storedLegacyKeep(test.memory)
        expect(statusOf(keep.files)).toEqual({ [MAIN]: 'unreadable', [backupKey(100)]: 'ok' })
        expect(new Map(test.store.files)).toEqual(before)
    })

    test('the agreement is asked even when nothing was skipped', async () => {
        const test = await rig({ trees: {}, mainByte: 1, lenient: { tree: treeWithColdChat(CHAT_UNIT), skipped: [] }, units: new Map([[CHAT_UNIT, chatUnit('x')]]) })
        const asked: (readonly SkippedLegacyEntry[])[] = []

        const result = await convertLegacyWithout(test.request, { ...accept, async confirmSkipped(entries) { asked.push(entries); return false } })

        expect(asked).toEqual([[]])
        expect(result).toEqual({ status: 'declined' })
        expect(test.memory.snapshot().size).toBe(0)
    })

    test('declining the named list writes nothing', async () => {
        const test = await rig({ trees: {}, mainByte: 1, lenient: { tree: treeWithColdChat(CHAT_UNIT), skipped } })

        const result = await convertLegacyWithout(test.request, { ...accept, async confirmSkipped() { return false } })

        expect(result).toEqual({ status: 'declined' })
        expect(test.memory.snapshot().size).toBe(0)
        expect((await test.memory.readCommit()).bytes).toBeNull()
    })

    test('a main file the lenient decode cannot read either is blocked, and one that is absent is named as such', async () => {
        const failing = await rig({ trees: {}, mainByte: 1 })
        expect(await convertLegacyWithout(failing.request, { ...accept })).toEqual({ status: 'blocked', reason: 'convert-lenient-failed', detail: expect.any(String) })
        const absent = await rig({ trees: {}, lenient: { tree: treeWithColdChat(CHAT_UNIT), skipped: [] } })
        expect(await convertLegacyWithout(absent.request, { ...accept })).toEqual({ status: 'blocked', reason: 'convert-main-unreadable', detail: expect.any(String) })
        expect(failing.memory.snapshot().size + absent.memory.snapshot().size).toBe(0)
    })
})

describe('new behaviour: failure points', () => {
    test('a marker that is refused leaves nothing staged', async () => {
        const test = await rig({ trees: { 1: treeWithColdChat(CHAT_UNIT) }, mainByte: 1, units: new Map([[CHAT_UNIT, chatUnit('x')]]) })
        test.memory.poke('store2/a-unit-a-peer-wrote', new Uint8Array([1]))

        const result = await convertLegacyProfile(test.request, accept)

        expect(result).toEqual({ status: 'reclassify' })
        expect((await test.memory.readCommit()).bytes).toBeNull()
    })

    test('a unit write that fails after the marker blocks, with the marker standing and no current manifest', async () => {
        const test = await rig({ trees: { 1: treeWithColdChat(CHAT_UNIT) }, mainByte: 1, units: new Map([[CHAT_UNIT, chatUnit('x')]]) })
        const backend: Store2Backend = { ...test.memory, putUnit: async () => { throw new Store2BackendFailureError('the put failed') } }
        test.request.backend = backend

        const result = await convertLegacyProfile(test.request, accept)

        expect(result).toEqual({ status: 'blocked', reason: 'install-upload-failed', detail: expect.any(String) })
        const key = await commitKeyOf(test.memory)
        expect(key.current).toBeNull()
        expect(key.staging).toMatchObject({ label: 'convert' })
    })
})

const DAMAGED_COMMIT = Uint8Array.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 62, 63])

interface Recorded {
    backend: Store2Backend
    /** Every mutating backend call in order, by method name. */
    writes: string[]
    /** What the commit key and the fence held right after each commit-key write that landed. */
    markers: { label: string | null, owner: string | null, fenceHeld: boolean }[]
}

/** The backend with every mutating call recorded. */
function recording(memory: MemoryBackend): Recorded {
    const writes: string[] = []
    const markers: Recorded['markers'] = []
    const backend: Store2Backend = {
        ...memory,
        casCommit: async (expected, next) => {
            writes.push('casCommit')
            const result = await memory.casCommit(expected, next)
            const key = classifyCommitRead(await memory.readCommit())
            markers.push({
                label: key.status === 'parsed' ? key.value.staging?.label ?? null : null,
                owner: key.status === 'parsed' ? key.value.staging?.owner ?? null : null,
                fenceHeld: (await memory.readFence()).bytes !== null,
            })
            return result
        },
        casFence: async (expected, next) => { writes.push('casFence'); return memory.casFence(expected, next) },
        putUnit: async (key, bytes) => { writes.push('putUnit'); return memory.putUnit(key, bytes) },
        commitOrdinary: async (expected, units, next) => { writes.push('commitOrdinary'); return memory.commitOrdinary(expected, units, next) },
        removeBatch: async (keys, expectedCommit, expectedFence) => { writes.push('removeBatch'); return memory.removeBatch(keys, expectedCommit, expectedFence) },
    }
    return { backend, writes, markers }
}

/** Everything the backend holds, as bytes: two equal states are byte-identical stores. */
async function storeState(memory: MemoryBackend) {
    return { units: new Map(memory.snapshot()), commit: (await memory.readCommit()).bytes, fence: (await memory.readFence()).bytes }
}

/** A recovery state (a damaged commit key) with the rig's request switched to the fenced `exit` entry over the key as read. */
async function exitRig(options: RigOptions) {
    const test = await rig(options)
    const plant = await test.memory.readCommit()
    await test.memory.casCommit(plant.token, DAMAGED_COMMIT)
    const commitRead = await test.memory.readCommit()
    const recorded = recording(test.memory)
    test.request.backend = recorded.backend
    test.request.entry = { kind: 'exit', commitRead }
    return { test, recorded, commitRead }
}

describe('new behaviour: the fenced exit entry', () => {
    const units = new Map<string, StoredUnit>([[CHAT_UNIT, chatUnit('kept')]])

    test('the fence is written before the marker, the marker is a convert marker of the request owner, and the tree is installed under its prefix', async () => {
        const { test, recorded } = await exitRig({ trees: { 1: treeWithColdChat(CHAT_UNIT) }, mainByte: 1, units })
        const before = new Map(test.store.files)

        const result = installed(await convertLegacyProfile(test.request, accept))

        expect(recorded.writes.indexOf('casFence')).toBeGreaterThanOrEqual(0)
        expect(recorded.writes.indexOf('casFence')).toBeLessThan(recorded.writes.indexOf('casCommit'))
        expect(recorded.markers[0]).toEqual({ label: 'convert', owner: test.grantOwner, fenceHeld: true })
        const key = await commitKeyOf(test.memory)
        expect(key.current?.key).toBe(result.manifestKey)
        expect(key.staging).toBeNull()
        expect(key.convertedFrom).toBe(fingerprintMainFile(new Uint8Array([1, 2, 3])))
        const stored = await storedTree(test.memory)
        expect(assembleDatabase(stored.manifest, stored.source)).toMatchObject({ characters: expect.any(Array) })
        expect(statusOf((await storedLegacyKeep(test.memory)).keep.files)).toEqual({ [MAIN]: 'ok' })
        expect(new Map(test.store.files)).toEqual(before)
        expect(test.store.writes).toEqual([])
    })

    test('a convert-without install goes the same way: fence, then marker, then the tree', async () => {
        const skipped: SkippedLegacyEntry[] = [{ name: 'cha-lost-1', kind: 'character', reason: 'block is missing' }]
        const { test, recorded } = await exitRig({ trees: {}, mainByte: 1, lenient: { tree: treeWithColdChat(CHAT_UNIT), skipped }, units })

        installed(await convertLegacyWithout(test.request, accept))

        expect(recorded.writes.indexOf('casFence')).toBeLessThan(recorded.writes.indexOf('casCommit'))
        expect(recorded.markers[0]).toMatchObject({ label: 'convert', fenceHeld: true })
        expect((await commitKeyOf(test.memory)).current).not.toBeNull()
    })

    test('a decline at the backup question leaves the store byte-identical and writes nothing', async () => {
        const { test, recorded } = await exitRig({ trees: { 1: 'bad', 8: treeWithColdChat(CHAT_UNIT) }, mainByte: 1, backups: { 100: 8 }, units })
        const before = await storeState(test.memory)
        let asked = 0

        const result = await convertLegacyProfile(test.request, { ...accept, async confirmFromBackup() { asked += 1; return false } })

        expect(asked).toBe(1)
        expect(result).toEqual({ status: 'declined' })
        expect(recorded.writes).toEqual([])
        expect(await storeState(test.memory)).toEqual(before)
    })

    test('a decline at the incomplete-data question leaves the store byte-identical and writes nothing', async () => {
        const { test, recorded } = await exitRig({ trees: { 1: treeWithColdChat(CHAT_UNIT) }, mainByte: 1 })
        const before = await storeState(test.memory)
        let asked = 0

        const result = await convertLegacyProfile(test.request, { ...accept, async confirmIncomplete() { asked += 1; return false } })

        expect(asked).toBe(1)
        expect(result).toEqual({ status: 'declined' })
        expect(recorded.writes).toEqual([])
        expect(await storeState(test.memory)).toEqual(before)
    })

    test('a decline at the skipped-blocks question leaves the store byte-identical and writes nothing', async () => {
        const skipped: SkippedLegacyEntry[] = [{ name: 'cha-lost-1', kind: 'character', reason: 'block is missing' }]
        const { test, recorded } = await exitRig({ trees: {}, mainByte: 1, lenient: { tree: treeWithColdChat(CHAT_UNIT), skipped }, units })
        const before = await storeState(test.memory)
        let asked = 0

        const result = await convertLegacyWithout(test.request, { ...accept, async confirmSkipped() { asked += 1; return false } })

        expect(asked).toBe(1)
        expect(result).toEqual({ status: 'declined' })
        expect(recorded.writes).toEqual([])
        expect(await storeState(test.memory)).toEqual(before)
    })

    test('every question is answered before the fence is written', async () => {
        const { test, recorded } = await exitRig({ trees: { 1: 'bad', 8: treeWithColdChat(CHAT_UNIT) }, mainByte: 1, backups: { 100: 8 } })
        const writesAtQuestion: number[] = []

        installed(await convertLegacyProfile(test.request, {
            async confirmFromBackup() { writesAtQuestion.push(recorded.writes.length); return true },
            async confirmIncomplete() { writesAtQuestion.push(recorded.writes.length); return true },
        }))

        expect(writesAtQuestion).toEqual([0, 0])
    })

    test.each([
        ['convert-read-failed', async () => exitRig({ trees: { 1: treeWithColdChat(CHAT_UNIT) }, mainByte: 1, units, faults: { errorKeys: new Set([CHAT_UNIT]) } }), 'strict'],
        ['convert-main-unreadable', async () => exitRig({ trees: {}, lenient: { tree: treeWithColdChat(CHAT_UNIT), skipped: [] } }), 'without'],
        ['convert-lenient-failed', async () => exitRig({ trees: {}, mainByte: 1 }), 'without'],
        ['backups-unlistable', async () => {
            const rigged = await exitRig({ trees: { 1: treeWithColdChat(CHAT_UNIT) }, mainByte: 1, units })
            rigged.test.request.listBackupTimes = async () => { throw new Error('the listing failed') }
            return rigged
        }, 'strict'],
    ] as const)('a %s block before the marker leaves the store byte-identical and writes nothing', async (reason, make, route) => {
        const { test, recorded } = await make()
        const before = await storeState(test.memory)

        const result = route === 'strict' ? await convertLegacyProfile(test.request, accept) : await convertLegacyWithout(test.request, accept)

        expect(result).toMatchObject({ status: 'blocked', reason })
        expect(recorded.writes).toEqual([])
        expect(await storeState(test.memory)).toEqual(before)
    })

    test('an exit that does not end marked is passed through: nothing is staged and the other writer\'s key stands', async () => {
        const { test, recorded, commitRead } = await exitRig({ trees: { 1: treeWithColdChat(CHAT_UNIT) }, mainByte: 1 })
        // A peer moves the commit key after the screen read it: the marker's compare-and-write is refused.
        const peerBytes = Uint8Array.from([9, 9, 9, 250, 251, 252, 253, 254, 255, 62, 63])
        await test.memory.casCommit(commitRead.token, peerBytes)

        const result = await convertLegacyProfile(test.request, accept)

        expect(result).toMatchObject({ status: 'exit', exit: { status: 'conflict' } })
        // The fence and the refused marker write are all this attempt did; no unit was staged.
        expect(recorded.writes).toEqual(['casFence', 'casCommit'])
        expect((await test.memory.readCommit()).bytes).toEqual(peerBytes)
    })

    test('a unit write that fails after the marker blocks with the fenced convert marker standing and no current manifest', async () => {
        const { test, recorded } = await exitRig({ trees: { 1: treeWithColdChat(CHAT_UNIT) }, mainByte: 1, units })
        test.request.backend = { ...recorded.backend, putUnit: async () => { throw new Store2BackendFailureError('the put failed') } }

        const result = await convertLegacyProfile(test.request, accept)

        expect(result).toEqual({ status: 'blocked', reason: 'install-upload-failed', detail: expect.any(String) })
        const key = await commitKeyOf(test.memory)
        expect(key.current).toBeNull()
        expect(key.staging).toMatchObject({ label: 'convert', owner: test.grantOwner })
        expect((await test.memory.readFence()).bytes).not.toBeNull()
    })

    test('the first-life entry still writes no fence', async () => {
        const test = await rig({ trees: { 1: treeWithColdChat(CHAT_UNIT) }, mainByte: 1, units })
        const recorded = recording(test.memory)
        test.request.backend = recorded.backend

        installed(await convertLegacyProfile(test.request, accept))

        expect(recorded.writes).not.toContain('casFence')
        expect((await test.memory.readFence()).bytes).toBeNull()
    })

    test('Tauri: a fenced convert exit interrupted after the marker is cleared at the next start and re-run through row 9', async () => {
        const { test } = await exitRig({ trees: { 1: treeWithColdChat(CHAT_UNIT) }, mainByte: 1, units })
        const interrupted = test.request.backend
        test.request.backend = { ...interrupted, putUnit: async () => { throw new Store2BackendFailureError('the page went away') } }
        expect(await convertLegacyProfile(test.request, accept)).toMatchObject({ status: 'blocked', reason: 'install-upload-failed' })
        const fenceLeft = (await test.memory.readFence()).bytes
        expect(fenceLeft).not.toBeNull()

        // The next start on a device that keeps its owner id: row 9 with the device's own convert marker.
        const read = await test.memory.readCommit()
        const decision = classifyBoot({
            commit: classifyCommitRead(read),
            fence: { state: 'absent', token: { kind: 'bytes', bytes: null } },
            presence: null,
            tree: null,
            upstreamMainFile: true,
            ownerId: test.grantOwner,
            deviceOwner: true,
        })
        expect(decision).toMatchObject({ row: 9, mode: 'rerun', operation: 'convert', clear: 'own' })
        const cleared = await runBootClear(committerOf(test.memory, createClock(), 7, { owner: test.grantOwner }), read, decision, test.grantOwner)
        expect(cleared?.status).toBe('cleared')
        const granted = firstLifeGrant({ decision, commitRead: await test.memory.readCommit(), startupClear: cleared })
        if (granted.status !== 'granted') {
            throw new Error(`The cleared marker was refused: ${granted.reason}`)
        }

        const rerun = installed(await convertLegacyProfile({ ...test.request, backend: test.memory, entry: { kind: 'first-life', grant: granted.grant } }, accept))

        expect((await commitKeyOf(test.memory)).current?.key).toBe(rerun.manifestKey)
        expect((await test.memory.readFence()).bytes).toEqual(fenceLeft)
    })
})
