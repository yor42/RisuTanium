/**
 * Fixtures of the legacy-tree tests: the `.bin` golden files read as a tree plus
 * a map of unit entries, a reader over that map with fault injection, and the
 * encode-and-assemble round trip the resolved trees must survive.
 *
 * The goldens are the files under `src/ts/drive/tests/binGoldens/`; the main
 * database entry is decoded with today's `decodeRisuSave`, which is what the
 * boot and the restore read the legacy tree with. `decodeRisuSave` is imported
 * lazily so a suite that mocks the application's modules has them in place
 * first.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Database } from 'src/ts/storage/database.svelte'
import { indexBackupEntries, parseBackupEntryHeader } from 'src/ts/drive/backupContainer'
import { coldStorageHeader, formatColdStorageLoadError, getColdStorageBackupKey, isAcceptedColdStorageBackupEntry } from 'src/ts/process/coldstorageData'
import { assembleDatabase, encodeDatabase, unitMapSource, type EncodedTree } from 'src/ts/storage/store2/codec'
import type { LegacyEntryReader, LegacyUnitRead } from 'src/ts/storage/store2/legacy/resolve'
import { fakeLists, seededEnv } from './codecFixtures'

const GOLDEN_DIR = path.resolve(process.env.BIN_GOLDENS_DIR ?? path.join(process.cwd(), 'src/ts/drive/tests/binGoldens'))

export const ID = {
    stubBlob: '00000000-0000-4000-8000-0000000000a1',
    inlineChatUnit: '00000000-0000-4000-8000-0000000000a2',
    blobChatUnit: '00000000-0000-4000-8000-0000000000a3',
    pluginUnit: '00000000-0000-4000-8000-0000000000a4',
    missingChatUnit: '00000000-0000-4000-8000-0000000000a5',
    errorTextUnit: '00000000-0000-4000-8000-0000000000a6',
} as const

export const FULL_GOLDENS = ['fork-full.bin', 'upstream-full.bin'] as const
export const MISSING_UNIT_GOLDENS = ['fork-missing-unit.bin', 'upstream-missing-unit.bin'] as const
export const STUB_GOLDENS = [
    ['fork-stub-missing-entry.bin', 'missing'],
    ['fork-stub-bad-json.bin', 'unparsable'],
    ['fork-stub-wrong-shape.bin', 'shape'],
    ['upstream-stub-missing-entry.bin', 'missing'],
    ['upstream-stub-bad-json.bin', 'unparsable'],
    ['upstream-stub-wrong-shape.bin', 'shape'],
] as const
export const ALL_GOLDENS = [
    ...FULL_GOLDENS, ...MISSING_UNIT_GOLDENS, 'upstream-plugin-object-no-entry.bin', ...STUB_GOLDENS.map(([name]) => name),
] as const

export type StoredUnit = { status: 'ok', value: unknown } | { status: 'unparsable' }

export interface Golden {
    /** The legacy tree the file's database entry decodes to. */
    tree: Database
    /** The unit entries of the file, by bare unit id, as a restore would store them. */
    units: Map<string, StoredUnit>
}

export async function loadGolden(name: string): Promise<Golden> {
    const bytes = new Uint8Array(fs.readFileSync(path.join(GOLDEN_DIR, name)))
    const walk = await indexBackupEntries(new Blob([bytes as unknown as Uint8Array<ArrayBuffer>]))
    const units = new Map<string, StoredUnit>()
    let database: Uint8Array | null = null
    for (const entry of walk.entries) {
        const parsed = parseBackupEntryHeader(bytes.subarray(entry.headerOffset, entry.headerOffset + entry.headerLength))
        if (parsed.status !== 'ok' || parsed.header.name === undefined) {
            throw new Error(`${name} has an entry whose header does not parse`)
        }
        const entryName = parsed.header.name
        const data = bytes.subarray(entry.headerOffset + entry.headerLength, entry.headerOffset + entry.headerLength + entry.dataLength)
        if (entryName === 'database.risudat') {
            database = data
            continue
        }
        const key = getColdStorageBackupKey(entryName)
        if (key === null) {
            continue
        }
        let value: unknown
        try {
            value = JSON.parse(new TextDecoder().decode(data))
        } catch {
            units.set(key, { status: 'unparsable' })
            continue
        }
        // The rule `LoadLocalBackup` applies to an entry: under the exporter's own name any JSON is a unit.
        if (isAcceptedColdStorageBackupEntry(entryName, value)) {
            units.set(key, { status: 'ok', value })
        }
    }
    if (database === null) {
        throw new Error(`${name} has no database entry`)
    }
    const { decodeRisuSave } = await import('src/ts/storage/risuSave')
    return { tree: await decodeRisuSave(database) as Database, units }
}

export interface FaultyReader extends LegacyEntryReader {
    /** Every key the reader was asked for, in order. */
    reads: string[]
}

/**
 * A reader over `units`. A key in `errorKeys` answers `{status: 'error'}`; a key in `throwKeys` rejects.
 * A missing key answers `{status: 'missing'}`.
 */
export function readerOver(
    units: ReadonlyMap<string, StoredUnit>,
    faults: { errorKeys?: ReadonlySet<string>, throwKeys?: ReadonlySet<string> } = {},
): FaultyReader {
    const reads: string[] = []
    return {
        reads,
        async read(key: string): Promise<LegacyUnitRead> {
            reads.push(key)
            if (faults.throwKeys?.has(key)) {
                throw new Error(`injected rejection for ${key}`)
            }
            if (faults.errorKeys?.has(key)) {
                return { status: 'error', error: new Error(`injected failure for ${key}`) }
            }
            return units.get(key) ?? { status: 'missing' }
        },
    }
}

/** A unit value read back as the object it is (the goldens' chat and character units are objects). */
export function unitValue(golden: Golden, key: string): Record<string, unknown> {
    const unit = golden.units.get(key)
    if (unit === undefined || unit.status !== 'ok') {
        throw new Error(`the golden holds no readable unit ${key}`)
    }
    return unit.value as Record<string, unknown>
}

/** A unit's parsed value of any shape (a plugin value is not always an object). */
export function unitValueOf(golden: Golden, key: string): unknown {
    const unit = golden.units.get(key)
    if (unit === undefined || unit.status !== 'ok') {
        throw new Error(`the golden holds no readable unit ${key}`)
    }
    return unit.value
}

/** Encodes `db` through the codec's byte path and assembles the units back. */
export function encodeAndAssemble(db: Database, seed = 3): { tree: EncodedTree, assembled: Database } {
    const tree = encodeDatabase(db, { env: seededEnv(seed), lists: fakeLists, seq: 1, createdAt: 1_700_000_000_000 })
    return { tree, assembled: assembleDatabase(tree.manifest, unitMapSource(tree.units)) }
}

export const DEEP = {
    stub: '00000000-0000-4000-8000-0000000000b1',
    chat: '00000000-0000-4000-8000-0000000000b2',
    errorNamed: '00000000-0000-4000-8000-0000000000b3',
    last: '00000000-0000-4000-8000-0000000000b4',
} as const

/**
 * A tree whose only root is a stub with an empty `coldStoragedChats`: the stub's unit holds a pointer chat, that chat's
 * unit starts with load-error text naming a second unit, and that unit starts with load-error text naming a third.
 * Every key but the stub's is reachable only through units.
 */
export function deepChain(): Golden {
    const message = (data: string) => ({ message: [{ time: 1, data, role: 'char' }] })
    const units = new Map<string, StoredUnit>([
        [DEEP.stub, { status: 'ok', value: { character: { chaId: 'cha-deep', name: 'Deep', type: 'character', chats: [{ id: 'c1', ...message(coldStorageHeader + DEEP.chat), note: '', name: '', localLore: [] }] } } }],
        [DEEP.chat, { status: 'ok', value: message(formatColdStorageLoadError(DEEP.errorNamed)) }],
        [DEEP.errorNamed, { status: 'ok', value: message(formatColdStorageLoadError(DEEP.last)) }],
        [DEEP.last, { status: 'ok', value: message('the end') }],
    ])
    const tree = {
        botPresets: [],
        characters: [{
            chaId: 'cha-deep', name: 'Deep', type: 'character', coldstorage: DEEP.stub, coldStoragedChats: [],
            chats: [{ id: 's1', message: [{ time: 1, data: '', role: 'char' }], note: '', name: '', localLore: [] }],
        }],
    } as unknown as Database
    return { tree, units }
}
export const CHAIN = {
    pointer: '00000000-0000-4000-8000-0000000000c1',
    first: '00000000-0000-4000-8000-0000000000c2',
    second: '00000000-0000-4000-8000-0000000000c3',
    stub: '00000000-0000-4000-8000-0000000000c4',
} as const

type Fields = Record<string, unknown>

export interface ChainOptions {
    /** What the original chat's first message is: a pointer to the chain's first unit (default) or load-error text naming the second step's unit. */
    root?: 'pointer' | 'errorText'
    /** The pointer unit holds no `scriptstate`, so the original chat's own must be cleared by the first step. */
    pointerUnitLacksScriptstate?: boolean
    /** The last unit is a bare message array. */
    bareEnd?: boolean
}

export interface Chain {
    /** An inline character holding the original chat. */
    tree: Database
    units: Map<string, StoredUnit>
    /** The original chat: message `[first, 't1']`, and its own value for each side field. */
    chat: Fields
}

const msg = (data: string, extra: Fields = {}): Fields => ({ time: 1, data, role: 'char', ...extra })

/**
 * A chain of archived chats with distinct values per depth. The original chat starts with a pointer (or load-error text)
 * and has the tail `t1`. Pointer unit: `[err(first), p2]`. First unit: `[err(second), e1b, e1c]`. Second unit: `[end, e2b]`.
 * Every unit carries all four side fields (unless an option says otherwise), and each unit's first message has its own
 * `chatId` that its accumulated `hypaV3Data.summaries` reference, so the merge's memo strip is observable at each step.
 * The final messages are `end, e2b, e1b, e1c, p2, t1`.
 */
export function chainFixture(options: ChainOptions = {}): Chain {
    const root = options.root ?? 'pointer'
    const rootText = root === 'pointer' ? coldStorageHeader + CHAIN.pointer : formatColdStorageLoadError(CHAIN.first)
    const chat: Fields = {
        id: 'chat-chain',
        message: [msg(rootText, { chatId: 'memo-orig' }), msg('t1', { role: 'user' })],
        note: '',
        name: '',
        hypaV2Data: { chunks: [], mainChunks: [{ id: 'orig' }], lastMainChunkID: 9 },
        hypaV3Data: { summaries: [{ text: 'orig', chatMemos: ['memo-orig'] }] },
        scriptstate: { orig: 1, shared: 'orig' },
        localLore: [{ key: 'orig-lore' }],
    }
    const pointerUnit: Fields = {
        message: [msg(formatColdStorageLoadError(CHAIN.first), { chatId: 'memo-P' }), msg('p2')],
        hypaV2Data: { chunks: [], mainChunks: [{ id: 'P' }], lastMainChunkID: 1 },
        hypaV3Data: { summaries: [{ text: 'sP', chatMemos: ['memo-P', 'memo-x'] }] },
        scriptstate: { shared: 'P', onlyP: 1 },
        localLore: [{ key: 'P-lore' }],
    }
    if (options.pointerUnitLacksScriptstate === true) {
        delete pointerUnit.scriptstate
    }
    const firstUnit: Fields = {
        message: [msg(formatColdStorageLoadError(CHAIN.second), { chatId: 'memo-1' }), msg('e1b'), msg('e1c')],
        hypaV2Data: { chunks: [], mainChunks: [], lastMainChunkID: 2 },
        hypaV3Data: { summaries: [{ text: 's1', chatMemos: ['memo-1', 'memo-y'] }] },
        scriptstate: { shared: '1', only1: 1 },
        localLore: [{ key: '1-lore' }],
    }
    const secondUnit: Fields | Fields[] = options.bareEnd === true
        ? [msg('end'), msg('e2b')]
        : {
            message: [msg('end'), msg('e2b')],
            hypaV2Data: { chunks: [], mainChunks: [{ id: '2' }], lastMainChunkID: 3 },
            hypaV3Data: { summaries: [{ text: 's2', chatMemos: ['memo-2'] }] },
            scriptstate: { shared: '2', only2: 1 },
            localLore: [{ key: '2-lore' }],
        }
    const units = new Map<string, StoredUnit>([
        [CHAIN.pointer, { status: 'ok', value: pointerUnit }],
        [CHAIN.first, { status: 'ok', value: firstUnit }],
        [CHAIN.second, { status: 'ok', value: secondUnit }],
    ])
    const tree = {
        botPresets: [],
        characters: [{ chaId: 'cha-chain', name: 'Chain', type: 'character', chats: [chat] }],
    } as unknown as Database
    return { tree, units, chat }
}