/**
 * The detector of shapes the store2 codec refuses (`legacy/faults.ts`): its predicate against the codec's own, its fault
 * table, and the equivalence the conversion relies on. For every fault shape, in both msgpack encodings and in the block
 * format, bytes written by the real older writer and read by the real strict decoder, the codec refuses the resolved
 * tree exactly when the detector reports a fault on it. The root `characters` rules are product rules, not codec
 * mirrors, and are asserted as refusals.
 *
 * Platform boundaries mocked as in `legacyConvertPresets.test.ts`. Fixture strings stay under 64 characters (msgpackr).
 */
import { describe, expect, test, vi } from 'vitest'
import type { ForageLike } from 'src/ts/storage/tests/forageBackedStore'

vi.mock('localforage', () => ({
    default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) }) },
}))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    forageStorage: { keys: vi.fn(async () => []), getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) },
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

import { coldStorageHeader } from 'src/ts/process/coldstorageData'
import type { Database } from 'src/ts/storage/database.svelte'
import { decodeRisuSave, encodeRisuSaveLegacy, RisuSaveEncoder } from 'src/ts/storage/risuSave'
import { CodecInputError } from 'src/ts/storage/store2/codec'
import { isJsonObject, toPlainJson } from 'src/ts/storage/store2/codec/normalize'
import {
    coalesceFaults, dropLegacyFaults, findCharacterFaults, findLegacyFaults, isObjectLike, legacyCharactersRefused, type LegacyFault,
} from 'src/ts/storage/store2/legacy/faults'
import { planWholeTreeInstall } from 'src/ts/storage/store2/legacy/install'
import { decodeLegacyLenient, type SkippedLegacyEntry } from 'src/ts/storage/store2/legacy/lenient'
import { resolveLegacyTree, type LegacyEntryReader } from 'src/ts/storage/store2/legacy/resolve'
import { BLOCK, composeSave } from '../manualCleanupHarness'
import { createClock, testEnv } from '../store2SaveKit'
import { buildSmall, fakeLists } from './codecFixtures'

type Obj = Record<string, unknown>
type Compression = 'noCompression' | 'compression'
const ENCODINGS: Compression[] = ['noCompression', 'compression']
const UNIT_A = '0b6f6a1e-3c1a-4d7e-9a6b-2f3e4d5c6b71'

function profile(mutate: (tree: Obj) => void = () => {}): Obj {
    const tree = JSON.parse(JSON.stringify(buildSmall(1)), (_key, value) => typeof value === 'string' && value.length > 60 ? value.slice(0, 60) : value) as Obj
    mutate(tree)
    return tree
}

const characterOf = (tree: Obj, index = 0) => (tree.characters as Obj[])[index]
const chatOf = (tree: Obj, index = 0) => (characterOf(tree).chats as Obj[])[index]

function stubOf(character: Obj, unit: string, own: Partial<Obj> = {}): Obj {
    return { type: 'character', name: character.name, chaId: character.chaId, coldstorage: unit, chats: [], ...own }
}

function readerOf(units: Record<string, unknown>): LegacyEntryReader {
    return {
        async read(key) {
            return key in units ? { status: 'ok', value: structuredClone(units[key]) } : { status: 'missing' }
        },
    }
}

function codecReadsObject(value: unknown): boolean {
    try {
        return isJsonObject(toPlainJson(value))
    } catch {
        return false
    }
}

describe('isObjectLike agrees with the codec', () => {
    const cases: [string, unknown][] = [
        ['null', null], ['undefined', undefined], ['number', 5], ['string', 'x'], ['boolean', true], ['bigint', 5n],
        ['function', () => 1], ['symbol', Symbol('s')], ['array', []], ['object', {}], ['null-prototype object', Object.assign(Object.create(null), { a: 1 })],
        ['Date', new Date(0)], ['Map', new Map()], ['Set', new Set([1])], ['Uint8Array', new Uint8Array(2)],
        ['boxed Number', new Number(5)], ['boxed String', new String('a')], ['boxed Boolean', new Boolean(true)],
        ['toJSON to a number', { toJSON: () => 5 }], ['toJSON to an object', { toJSON: () => ({ a: 1 }) }],
        ['toJSON to an array', { toJSON: () => [] }], ['toJSON to undefined', { toJSON: () => undefined }],
        ['toJSON to a boxed number', { toJSON: () => new Number(1) }], ['toJSON to null', { toJSON: () => null }],
    ]
    test.each(cases)('%s', (_label, value) => {
        expect(isObjectLike(value)).toBe(codecReadsObject(value))
    })

    test('unit: the predicate is shallow, so a cycle inside an object is the safety net\'s', () => {
        const cyclic: Obj = {}
        cyclic.self = cyclic
        expect(isObjectLike(cyclic)).toBe(true)
        expect(codecReadsObject(cyclic)).toBe(false)
    })
})

describe('findLegacyFaults: the fault table', () => {
    const fieldsOf = (tree: unknown) => findLegacyFaults(tree).map(fault => `${fault.kind}:${fault.field}`)

    test.each([
        ['botPresets not a list', { botPresets: 'x' }, ['presets:botPresets']],
        ['botPresets element', { botPresets: [{ a: 1 }, 5, null, new Date(0)] }, ['presets:botPresets[1]', 'presets:botPresets[2]', 'presets:botPresets[3]']],
        ['modules not a list', { modules: { a: 1 } }, ['modules:modules']],
        ['modules element', { modules: [5] }, ['modules:modules[0]']],
        ['loadouts not a list', { loadouts: 'x' }, ['loadouts:loadouts']],
        ['plugins not a list', { plugins: 'x' }, ['plugins:plugins']],
        ['plugins element', { plugins: [{}, []] }, ['plugins:plugins[1]']],
        ['pluginV2 not a list', { pluginV2: { a: 1 } }, ['plugins:pluginV2']],
        ['pluginV2 element', { pluginV2: [5] }, ['plugins:pluginV2[0]']],
        ['pluginCustomStorage not an object', { pluginCustomStorage: [] }, ['pluginStorage:pluginCustomStorage']],
        ['character slot', { characters: [{}, 5, null, []] }, ['character:characters[1]', 'character:characters[2]', 'character:characters[3]']],
        ['chats not a list', { characters: [{ chats: 'x' }] }, ['chats:characters[0].chats']],
        ['chat element', { characters: [{ chats: [{}, 5, new Date(0)] }] }, ['chats:characters[0].chats[1]', 'chats:characters[0].chats[2]']],
        ['message not a list', { characters: [{ chats: [{ message: 'x' }] }] }, ['chats:characters[0].chats[0].message']],
        ['message element', { characters: [{ chats: [{ message: [{}, 5] }] }] }, ['chats:characters[0].chats[0].message[1]']],
    ] as [string, Obj, string[]][])('%s', (_label, tree, expected) => {
        expect(fieldsOf(tree)).toEqual(expected)
    })

    test('unit: what the codec tolerates is not a fault', () => {
        expect(fieldsOf({})).toEqual([])
        expect(fieldsOf(null)).toEqual([])
        expect(fieldsOf('a bare string')).toEqual([])
        expect(fieldsOf({
            botPresets: [], modules: [], loadouts: [5, 'x', null], plugins: null, pluginV2: undefined, pluginCustomStorage: null,
            characterOrder: 'x', characters: [{ chaId: 5, chats: null }, { chats: [{ message: null }, { }] }],
        })).toEqual([])
        expect(fieldsOf({ botPresets: null, modules: undefined, characters: 'x' })).toEqual([])
    })

    test('unit: a stub is not judged by its own chats, a character without the stub flag is', () => {
        expect(fieldsOf({ characters: [{ coldstorage: UNIT_A, chats: 'x' }] })).toEqual([])
        expect(fieldsOf({ characters: [{ coldstorage: '', chats: 'x' }] })).toEqual(['chats:characters[0].chats'])
        expect(fieldsOf({ characters: [{ coldstorage: UNIT_A }, 5] })).toEqual(['character:characters[1]'])
    })

    test('findCharacterFaults judges one character by the same chat rules and names it by the given path', () => {
        expect(findCharacterFaults({ chats: [5, { message: [1] }] }, 'unit').map(fault => fault.field)).toEqual(['unit.chats[0]', 'unit.chats[1].message[0]'])
        expect(findCharacterFaults(5)).toEqual([])
        expect(findCharacterFaults({ chats: [] })).toEqual([])
    })

    test('the detector never writes the tree it reads', () => {
        const tree = { botPresets: [5], characters: [{ chats: [{ message: [5] }] }, 7] }
        const before = structuredClone(tree)
        findLegacyFaults(tree)
        expect(tree).toEqual(before)
    })
})

describe('legacyCharactersRefused', () => {
    test.each([
        ['a list', { characters: [] }, false, false],
        ['a string', { characters: 'x' }, true, true],
        ['an object', { characters: { a: 1 } }, true, true],
        ['missing', {}, true, false],
        ['null', { characters: null }, true, false],
        ['a root that is not an object', 'a bare string', true, false],
        ['a null root', null, true, false],
    ] as [string, unknown, boolean, boolean][])('%s: older format refuses %s, block format refuses %s', (_label, tree, olderFormat, blockFormat) => {
        expect(legacyCharactersRefused(tree, true)).toBe(olderFormat)
        expect(legacyCharactersRefused(tree, false)).toBe(blockFormat)
    })
})

interface ParityCase {
    label: string
    mutate(tree: Obj): void
    units?: Record<string, unknown>
    /** The codec refuses the resolved tree. */
    faulty: boolean
    /** The detector reports a fault on the tree as the decoder returned it, before the resolve. Defaults to `faulty`. */
    asRead?: boolean
}

const MSG = { role: 'user', data: 'tail-ok', time: 2 }

const PARITY: ParityCase[] = [
    { label: 'control: the profile as it is', mutate: () => {}, faulty: false },
    ...(['modules', 'loadouts', 'plugins', 'pluginV2'] as const).flatMap((part): ParityCase[] => [
        { label: `${part} a string`, mutate: tree => { tree[part] = 'x' }, faulty: true },
        { label: `${part} an object`, mutate: tree => { tree[part] = { a: 1 } }, faulty: true },
        { label: `${part} missing`, mutate: tree => { delete tree[part] }, faulty: false },
        { label: `${part} null`, mutate: tree => { tree[part] = null }, faulty: false },
        { label: `${part} empty`, mutate: tree => { tree[part] = [] }, faulty: false },
    ]),
    ...(['modules', 'plugins', 'pluginV2'] as const).flatMap((part): ParityCase[] => [
        { label: `${part} [5]`, mutate: tree => { tree[part] = [5] }, faulty: true },
        { label: `${part} [null]`, mutate: tree => { tree[part] = [null] }, faulty: true },
        { label: `${part} [Date]`, mutate: tree => { tree[part] = [new Date(0)] }, faulty: true },
        { label: `${part} [[]]`, mutate: tree => { tree[part] = [[]] }, faulty: true },
    ]),
    { label: 'loadouts [5]', mutate: tree => { tree.loadouts = [5] }, faulty: false },
    { label: 'characterOrder a string', mutate: tree => { tree.characterOrder = 'x' }, faulty: false },
    { label: 'pluginCustomStorage a string', mutate: tree => { tree.pluginCustomStorage = 'x' }, faulty: true },
    { label: 'pluginCustomStorage an array', mutate: tree => { tree.pluginCustomStorage = [] }, faulty: true },
    { label: 'pluginCustomStorage a Date', mutate: tree => { tree.pluginCustomStorage = new Date(0) }, faulty: true },
    { label: 'pluginCustomStorage null', mutate: tree => { tree.pluginCustomStorage = null }, faulty: false },
    { label: 'botPresets a string', mutate: tree => { tree.botPresets = 'x' }, faulty: true },
    { label: 'botPresets an object', mutate: tree => { tree.botPresets = { a: { name: 'a' } } }, faulty: true },
    { label: 'botPresets [5, ok]', mutate: tree => { tree.botPresets = [5, { name: 'ok' }] }, faulty: true },
    { label: 'botPresets [null]', mutate: tree => { tree.botPresets = [null] }, faulty: true },
    { label: 'botPresets [Date]', mutate: tree => { tree.botPresets = [new Date(0)] }, faulty: true },
    { label: 'botPresets empty', mutate: tree => { tree.botPresets = [] }, faulty: false },
    ...([['5', 5], ['null', null], ['an array', []]] as [string, unknown][]).map(([name, slot]): ParityCase => ({
        label: `characters[0] is ${name}`,
        mutate: tree => { (tree.characters as unknown[])[0] = slot },
        faulty: true,
    })),
    {
        // Without the opt-in the resolve keeps a plain-object test of its own and rewrites a Date slot to an empty object, as the `.bin` import has always had it, so only the tree as read still holds the fault.
        label: 'characters[0] is a Date',
        mutate: tree => { (tree.characters as unknown[])[0] = new Date(0) },
        faulty: false,
        asRead: true,
    },
    { label: 'chats a string', mutate: tree => { characterOf(tree).chats = 'x' }, faulty: true },
    { label: 'chats an object', mutate: tree => { characterOf(tree).chats = { a: 1 } }, faulty: true },
    { label: 'chats [5]', mutate: tree => { characterOf(tree).chats = [5] }, faulty: true },
    { label: 'chats [null]', mutate: tree => { characterOf(tree).chats = [null] }, faulty: true },
    { label: 'chats [Date]', mutate: tree => { characterOf(tree).chats = [new Date(0)] }, faulty: true },
    { label: 'chats empty', mutate: tree => { characterOf(tree).chats = [] }, faulty: false },
    { label: 'chats null', mutate: tree => { characterOf(tree).chats = null }, faulty: false },
    { label: 'message a string', mutate: tree => { chatOf(tree).message = 'x' }, faulty: true },
    { label: 'message [5]', mutate: tree => { chatOf(tree).message = [5] }, faulty: true },
    { label: 'message [ok, 5]', mutate: tree => { chatOf(tree).message = [MSG, 5] }, faulty: true },
    { label: 'message [null]', mutate: tree => { chatOf(tree).message = [null] }, faulty: true },
    { label: 'message null', mutate: tree => { chatOf(tree).message = null }, faulty: false },
    {
        label: 'a stub whose own chats is a string and whose unit is valid',
        mutate: tree => {
            const unit = structuredClone(characterOf(tree))
            tree.characters = [stubOf(characterOf(tree), UNIT_A, { chats: 'x' })]
            Object.assign(parityUnits, { [UNIT_A]: { character: unit } })
        },
        faulty: false,
    },
    {
        label: 'a stub whose unit holds chats [5]',
        mutate: tree => {
            const unit = structuredClone(characterOf(tree))
            unit.chats = [5]
            tree.characters = [stubOf(characterOf(tree), UNIT_A)]
            Object.assign(parityUnits, { [UNIT_A]: { character: unit } })
        },
        faulty: true,
        asRead: false,
    },
    {
        label: 'a pointer chat whose unit is [5]',
        mutate: tree => { chatOf(tree).message = [{ role: 'char', data: coldStorageHeader + UNIT_A, time: 1 }]; Object.assign(parityUnits, { [UNIT_A]: [5] }) },
        faulty: true,
        asRead: false,
    },
    {
        label: 'a pointer chat followed by a good and a bad message',
        mutate: tree => {
            chatOf(tree).message = [{ role: 'char', data: coldStorageHeader + UNIT_A, time: 1 }, MSG, 5]
            Object.assign(parityUnits, { [UNIT_A]: [{ role: 'user', data: 'u1', time: 0 }, { role: 'char', data: 'u2', time: 0 }] })
        },
        faulty: true,
    },
]

/** The cold units a case's `mutate` registers; reset before each case. */
const parityUnits: Record<string, unknown> = {}

async function refusedByCodec(database: Database): Promise<boolean> {
    try {
        await planWholeTreeInstall(database, { lists: fakeLists, env: testEnv(createClock(), 1), convertedFrom: 'fingerprint' })
        return false
    } catch (error) {
        if (error instanceof CodecInputError) {
            return true
        }
        throw error
    }
}

describe.each(ENCODINGS)('detector half of the parity with the codec (%s)', (encoding) => {
    test.each(PARITY.map(entry => [entry.label, entry] as const))('%s', async (_label, entry) => {
        for (const key of Object.keys(parityUnits)) {
            delete parityUnits[key]
        }
        const tree = profile(entry.mutate)
        const decoded = await decodeRisuSave(encodeRisuSaveLegacy(tree, encoding), { strict: true }) as unknown as Obj

        const resolved = await resolveLegacyTree(decoded as unknown as Database, readerOf(parityUnits))

        const refused = await refusedByCodec(resolved.database)
        expect(refused).toBe(entry.faulty)
        expect(findLegacyFaults(resolved.database).length > 0).toBe(refused)
        expect(findLegacyFaults(decoded).length > 0).toBe(entry.asRead ?? entry.faulty)
    })
})

describe('detector half of the parity with the codec, for values no decoder produces', () => {
    test.each([
        ['modules element a boxed Number', (tree: Obj) => { tree.modules = [new Number(5)] }, true],
        ['modules element toJSON to a number', (tree: Obj) => { tree.modules = [{ toJSON: () => 5 }] }, true],
        ['modules element toJSON to an object', (tree: Obj) => { tree.modules = [{ toJSON: () => ({ id: 'm', name: 'm' }) }] }, false],
        ['modules element toJSON to an array', (tree: Obj) => { tree.modules = [{ toJSON: () => [] }] }, true],
        ['message toJSON to undefined', (tree: Obj) => { chatOf(tree).message = [{ toJSON: () => undefined }] }, true],
        ['message a boxed String', (tree: Obj) => { chatOf(tree).message = [new String('a')] }, true],
        ['chat toJSON to an object', (tree: Obj) => { characterOf(tree).chats = [{ toJSON: () => ({ message: [] }) }] }, false],
        ['chat toJSON to an object with a bad message list', (tree: Obj) => { characterOf(tree).chats = [{ toJSON: () => ({ message: 'x' }) }] }, true],
        ['character toJSON to an object with bad chats', (tree: Obj) => { tree.characters = [{ toJSON: () => ({ ...characterOf(tree), chats: 'x' }) }] }, true],
        ['botPresets element toJSON to a boxed Boolean', (tree: Obj) => { tree.botPresets = [{ toJSON: () => new Boolean(true) }] }, true],
    ] as [string, (tree: Obj) => void, boolean][])('%s', async (_label, mutate, faulty) => {
        const tree = profile(mutate)

        const resolved = await resolveLegacyTree(tree as unknown as Database, readerOf({}))

        const refused = await refusedByCodec(resolved.database)
        expect(refused).toBe(faulty)
        expect(findLegacyFaults(resolved.database).length > 0).toBe(refused)
    })
})

describe('detector half of the parity with the codec, block format', () => {
    async function blockTree(parts: { name: string, type: number, data: string }[]): Promise<Database> {
        const bytes = (await composeSave(new RisuSaveEncoder(), parts)).bytes
        return await decodeRisuSave(bytes, { strict: true }) as unknown as Database
    }
    const root = (directory: string[]) => ({ name: 'root', type: BLOCK.ROOT, data: JSON.stringify({ formatversion: 5, __directory: directory }) })
    const preset = { name: 'preset', type: BLOCK.BOTPRESET, data: '[{"name":"p"}]' }

    test('unit: a modules block holding an object is refused by the codec and reported', async () => {
        const decoded = await blockTree([root(['preset', 'modules']), preset, { name: 'modules', type: BLOCK.MODULES, data: '{"a":1}' }])

        const resolved = await resolveLegacyTree(decoded, readerOf({}))

        expect(await refusedByCodec(resolved.database)).toBe(true)
        expect(findLegacyFaults(decoded).map(fault => fault.kind)).toEqual(['modules'])
    })

    test('unit: a character block whose chats is a string is refused by the codec and reported', async () => {
        const character = { type: 'character', chaId: 'cha1', name: 'n', chats: 'x', chatPage: 0 }
        const decoded = await blockTree([root(['preset', 'cha1']), preset, { name: 'cha1', type: BLOCK.CHARACTER_WITH_CHAT, data: JSON.stringify(character) }])

        const resolved = await resolveLegacyTree(decoded, readerOf({}))

        expect(await refusedByCodec(resolved.database)).toBe(true)
        expect(findLegacyFaults(decoded).map(fault => fault.kind)).toEqual(['chats'])
    })

    test('unit: a block-format save with no characters has no fault and the codec takes it; its missing list is not a refusal there', async () => {
        const decoded = await blockTree([root(['preset', 'modules']), preset, { name: 'modules', type: BLOCK.MODULES, data: '[]' }])

        const resolved = await resolveLegacyTree(decoded, readerOf({}))

        expect(findLegacyFaults(decoded)).toEqual([])
        expect(await refusedByCodec(resolved.database)).toBe(false)
        expect(legacyCharactersRefused(decoded, false)).toBe(false)
    })
})

describe.each(ENCODINGS)('root characters rows are refusals, not codec mirrors (%s)', (encoding) => {
    test.each([
        ['missing', (tree: Obj) => { delete tree.characters }],
        ['null', (tree: Obj) => { tree.characters = null }],
        ['a string', (tree: Obj) => { tree.characters = 'x' }],
        ['an object', (tree: Obj) => { tree.characters = { a: 1 } }],
    ] as [string, (tree: Obj) => void][])('unit: characters %s is refused for the older format', async (_label, mutate) => {
        const decoded = await decodeRisuSave(encodeRisuSaveLegacy(profile(mutate), encoding), { strict: true })

        expect(legacyCharactersRefused(decoded, true)).toBe(true)
    })
})

describe.each(ENCODINGS)('the opt-in resolve and the drop against the codec, the as-read tree and the lenient list (%s)', (encoding) => {
    test.each(PARITY.map(entry => [entry.label, entry] as const))('%s', async (_label, entry) => {
        for (const key of Object.keys(parityUnits)) {
            delete parityUnits[key]
        }
        const bytes = encodeRisuSaveLegacy(profile(entry.mutate), encoding)
        const decoded = await decodeRisuSave(bytes, { strict: true }) as unknown as Database
        const asRead = findLegacyFaults(decoded)

        const plain = await resolveLegacyTree(decoded, readerOf(parityUnits))
        const flagged = await resolveLegacyTree(decoded, readerOf(parityUnits), { faultyUnitsUnusable: true, newId: () => 'placeholder-chat' })

        // The tree the conversion drops from holds exactly what the tree as read holds, and what the codec refuses.
        expect(findLegacyFaults(flagged.database).length > 0).toBe(asRead.length > 0)
        expect(await refusedByCodec(flagged.database)).toBe(asRead.length > 0)
        // A unit the codec would refuse is unusable under the opt-in, and only then.
        if (asRead.length === 0) {
            expect(await refusedByCodec(plain.database)).toBe(flagged.incomplete.length > plain.incomplete.length)
        }
        // T-agree: the kinds the lenient read names are the kinds left on the tree the drop works on.
        const named = new Set((await decodeLegacyLenient(bytes)).skipped.map(skipped => skipped.kind))
        expect(named).toEqual(new Set(findLegacyFaults(flagged.database).map(fault => fault.kind)))
        // After the drop the codec takes the tree.
        const dropped = dropLegacyFaults(flagged.database, () => 'new-chat')
        expect(findLegacyFaults(dropped.database)).toEqual([])
        expect(await refusedByCodec(dropped.database)).toBe(false)
    })
})

describe('the opt-in resolve and the drop, block format', () => {
    const root = (directory: string[]) => ({ name: 'root', type: BLOCK.ROOT, data: JSON.stringify({ formatversion: 5, __directory: directory }) })
    const preset = { name: 'preset', type: BLOCK.BOTPRESET, data: '[{"name":"p"}]' }

    test.each([
        ['a modules block holding an object', [root(['preset', 'modules']), preset, { name: 'modules', type: BLOCK.MODULES, data: '{"a":1}' }], ['modules']],
        [
            'a character block whose chats is a string',
            [root(['preset', 'cha1']), preset, { name: 'cha1', type: BLOCK.CHARACTER_WITH_CHAT, data: JSON.stringify({ type: 'character', chaId: 'cha1', name: 'n', chats: 'x', chatPage: 0 }) }],
            ['chats'],
        ],
    ] as [string, { name: string, type: number, data: string }[], string[]][])('%s: the lenient kinds are the kinds on the resolved tree, and the drop leaves the codec nothing to refuse', async (_label, parts, kinds) => {
        const bytes = (await composeSave(new RisuSaveEncoder(), parts)).bytes
        const decoded = await decodeRisuSave(bytes, { strict: true }) as unknown as Database

        const flagged = await resolveLegacyTree(decoded, readerOf({}), { faultyUnitsUnusable: true })

        expect((await decodeLegacyLenient(bytes)).skipped.map(skipped => skipped.kind)).toEqual(kinds)
        expect([...new Set(findLegacyFaults(flagged.database).map(fault => fault.kind))]).toEqual(kinds)
        expect(await refusedByCodec(dropLegacyFaults(flagged.database, () => 'new-chat').database)).toBe(false)
    })

    test('a salvage entry and a detector fault of one kind are one entry; the salvage entry is kept as it is', async () => {
        const parts = [
            { name: 'root', type: BLOCK.ROOT, data: JSON.stringify({ formatversion: 5, pluginV2: 'x', __directory: ['preset', 'plugins'] }) }, preset,
            { name: 'plugins', type: BLOCK.PLUGINS, data: '{not json' },
        ]
        const bytes = (await composeSave(new RisuSaveEncoder(), parts)).bytes

        const { skipped } = await decodeLegacyLenient(bytes)

        expect(skipped.map(entry => entry.kind)).toEqual(['plugins'])
        expect(skipped[0].name).toBe('plugins')
    })
})

describe('coalesceFaults', () => {
    const fault = (kind: LegacyFault['kind'], field: string): LegacyFault => ({ kind, field, reason: `${field} is bad.` })
    const entry = (name: string, kind: SkippedLegacyEntry['kind']): SkippedLegacyEntry => ({ name, kind, reason: 'x' })

    test('unit: one entry per kind however many parts are faulty; plugins and pluginV2 are one kind; every chat fault is one chats entry', () => {
        const entries = coalesceFaults([
            fault('plugins', 'plugins[0]'), fault('plugins', 'pluginV2'), fault('chats', 'characters[0].chats'), fault('chats', 'characters[3].chats[1].message[2]'),
            fault('modules', 'modules'), fault('modules', 'modules[4]'),
        ])

        expect(entries.map(skipped => skipped.kind)).toEqual(['plugins', 'chats', 'modules'])
        expect(entries.map(skipped => skipped.name)).toEqual(['plugins[0]', 'characters[0].chats', 'modules'])
    })

    test('unit: every skipped character slot is its own entry, with an empty name', () => {
        const entries = coalesceFaults([fault('character', 'characters[0]'), fault('chats', 'characters[1].chats'), fault('character', 'characters[2]')])

        expect(entries.map(skipped => [skipped.kind, skipped.name])).toEqual([['character', ''], ['chats', 'characters[1].chats'], ['character', '']])
    })

    test('unit: salvage entries are kept first and as they are, a kind they name is not named again, a salvaged character is not a kind', () => {
        const salvaged = [entry('plugins', 'plugins'), entry('cha-lost', 'character'), entry('blk-1', 'other'), entry('blk-2', 'other')]

        const entries = coalesceFaults([fault('plugins', 'pluginV2'), fault('chats', 'characters[0].chats'), fault('character', 'characters[2]')], salvaged)

        expect(entries.slice(0, 4)).toEqual(salvaged)
        expect(entries.slice(4).map(skipped => [skipped.kind, skipped.name])).toEqual([['chats', 'characters[0].chats'], ['character', '']])
    })

    test('unit: nothing faulty names nothing', () => {
        expect(coalesceFaults([])).toEqual([])
        expect(coalesceFaults([], [entry('x', 'other')])).toEqual([entry('x', 'other')])
    })
})

describe('dropLegacyFaults', () => {
    const drop = (db: Obj) => dropLegacyFaults(db as unknown as Database, () => 'new-chat')
    const asObj = (db: Database) => db as unknown as Obj
    const chat = (name: string, extra: Obj = {}): Obj => ({ id: name, name, message: [{ role: 'user', data: name, time: 1 }], note: '', localLore: [], ...extra })

    test('unit: it never mutates the tree and shares everything it did not change; every container on a changed path is new', () => {
        const kept = chat('kept')
        const untouched = { type: 'character', chaId: 'a', name: 'a', chats: [kept] }
        const faulty = { type: 'character', chaId: 'b', name: 'b', chats: [chat('c0', { message: [{ data: 'm' }, 5] }), kept] }
        const tree: Obj = { botPresets: [{ name: 'p' }], modules: [{ name: 'm' }], characters: [untouched, faulty], plugins: [{ name: 'pl' }] }
        const before = structuredClone(tree)

        const { database } = drop(tree)
        const out = asObj(database)

        expect(tree).toEqual(before)
        expect(out).not.toBe(tree)
        expect(out.botPresets).toBe(tree.botPresets)
        expect(out.modules).toBe(tree.modules)
        expect(out.plugins).toBe(tree.plugins)
        const characters = out.characters as Obj[]
        expect(characters).not.toBe(tree.characters)
        expect(characters[0]).toBe(untouched)
        expect(characters[1]).not.toBe(faulty)
        const changedChats = characters[1].chats as Obj[]
        expect(changedChats).not.toBe(faulty.chats)
        expect(changedChats[0]).not.toBe((faulty.chats as Obj[])[0])
        expect(changedChats[0].message).not.toBe((faulty.chats as Obj[])[0].message)
        expect(changedChats[1]).toBe(kept)
    })

    test('unit: a tree with no fault comes back as a new top-level object holding the same parts', () => {
        const tree: Obj = { botPresets: [{ name: 'p' }], characters: [{ chaId: 'a', chats: [] }], loadouts: [5] }

        const { database, presetsEmptied } = drop(tree)

        expect(asObj(database)).not.toBe(tree)
        expect(asObj(database)).toEqual(tree)
        expect((asObj(database).characters as unknown[])[0]).toBe((tree.characters as unknown[])[0])
        expect(presetsEmptied).toBe(false)
    })

    test('unit: parts that are present and not lists become empty lists, plugin storage an empty object, missing parts stay missing', () => {
        const out = asObj(drop({ modules: 'x', loadouts: { a: 1 }, plugins: 5, pluginV2: 'x', pluginCustomStorage: [], characters: [] }).database)

        expect(out).toEqual({ modules: [], loadouts: [], plugins: [], pluginV2: [], pluginCustomStorage: {}, characters: [] })
        expect(Object.keys(asObj(drop({ characters: [] }).database))).toEqual(['characters'])
    })

    test('unit: loadouts elements are not judged', () => {
        expect(asObj(drop({ loadouts: [5, null, 'x'] }).database).loadouts).toEqual([5, null, 'x'])
    })

    test.each([
        ['stays and moves up', 2, 1],
        ['was dropped: one past the kept ones', 1, 2],
        ['stays at 0', 0, 0],
        ['past the end is left alone', 3, 3],
        ['-1 is left alone', -1, -1],
        ['not an integer is left alone', 0.5, 0.5],
        ['not a number is left alone', 'x', 'x'],
    ] as [string, unknown, unknown][])('unit: botPresets [p0, 5, p2], botPresetsId %s', (_label, before, after) => {
        const { database, presetsEmptied } = drop({ botPresets: [{ name: 'p0' }, 5, { name: 'p2' }], botPresetsId: before })

        expect(asObj(database).botPresetsId).toBe(after)
        expect((asObj(database).botPresets as Obj[]).map(preset => preset.name)).toEqual(['p0', 'p2'])
        expect(presetsEmptied).toBe(false)
    })

    test('unit: no preset left, or a preset list that is not a list, says presetsEmptied and leaves botPresetsId alone', () => {
        for (const botPresets of [[5, null], 'x', { a: 1 }]) {
            const { database, presetsEmptied } = drop({ botPresets, botPresetsId: 4 })

            expect(presetsEmptied).toBe(true)
            expect(asObj(database).botPresets).toEqual([])
            expect(asObj(database).botPresetsId).toBe(4)
        }
        expect(drop({ botPresets: [] }).presetsEmptied).toBe(false)
        expect(drop({}).presetsEmptied).toBe(false)
    })

    test.each([
        ['stays and moves up', 2, 1],
        ['was dropped: the last kept chat', 4, 2],
        ['stays at 0', 0, 0],
        ['past the end is left alone', 9, 9],
        ['not a number is left alone', '1', '1'],
    ] as [string, unknown, unknown][])('unit: chats [c0, 5, c1, c2, 5], chatPage %s', (_label, before, after) => {
        const { database } = drop({ characters: [{ chaId: 'a', chatPage: before, chats: [chat('c0'), 5, chat('c1'), chat('c2'), 5] }] })

        const character = (asObj(database).characters as Obj[])[0]
        expect((character.chats as Obj[]).map(kept => kept.name)).toEqual(['c0', 'c1', 'c2'])
        expect(character.chatPage).toBe(after)
    })

    test('unit: a chat that only lost a message keeps chatPage; a missing chatPage stays missing', () => {
        const withPage = (asObj(drop({ characters: [{ chatPage: 1, chats: [chat('c0'), chat('c1', { message: [5] })] }] }).database).characters as Obj[])[0]
        const withoutPage = (asObj(drop({ characters: [{ chats: [5, chat('c1')] }] }).database).characters as Obj[])[0]

        expect(withPage.chatPage).toBe(1)
        expect(Object.hasOwn(withoutPage, 'chatPage')).toBe(false)
    })

    test.each([
        ['chats a string', 'x'], ['chats an object', { a: 1 }], ['every chat dropped', [5, null]],
    ] as [string, unknown][])('unit: %s gives one new empty chat, selected', (_label, chats) => {
        const { database } = drop({ characters: [{ chaId: 'a', chatPage: 3, chats }] })

        const character = (asObj(database).characters as Obj[])[0]
        expect(character.chats).toEqual([{ id: 'new-chat', message: [], note: '', name: 'Chat 1', localLore: [] }])
        expect(character.chatPage).toBe(0)
    })

    test('unit: chats that are [], null or missing as read are left as they are, and the id source is not asked', () => {
        let asked = 0
        const out = dropLegacyFaults({ characters: [{ chats: [] }, { chats: null }, { chaId: 'c' }, 5] } as unknown as Database, () => `id-${++asked}`)

        expect(asked).toBe(0)
        expect(asObj(out.database).characters).toEqual([{ chats: [] }, { chats: null }, { chaId: 'c' }])
    })

    test('unit: a message that is not an object goes, a message list that is not a list becomes empty, and fmIndex and the other chat fields are untouched', () => {
        const { database } = drop({ characters: [{ chats: [
            chat('a', { fmIndex: 3, message: [{ data: '1' }, 5, { data: '2' }] }), chat('b', { fmIndex: 2, message: 'x' }), chat('c', { message: null }),
        ] }] })

        const chats = (asObj(database).characters as Obj[])[0].chats as Obj[]
        expect((chats[0].message as Obj[]).map(message => message.data)).toEqual(['1', '2'])
        expect(chats[0].fmIndex).toBe(3)
        expect(chats[1].message).toEqual([])
        expect(chats[1].fmIndex).toBe(2)
        expect(chats[2].message).toBeNull()
    })

    test('unit: a character slot that is not an object is left out and the order of the others kept', () => {
        const { database } = drop({ characters: [{ chaId: 'a' }, 5, { chaId: 'b' }, null, [], new Date(0), { chaId: 'c' }] })

        expect((asObj(database).characters as Obj[]).map(character => character.chaId)).toEqual(['a', 'b', 'c'])
    })

    test('unit: a stub keeps its own chats, as the detector does not judge them', () => {
        const stub = { chaId: 'a', coldstorage: 'unit', chats: 'x' }

        expect((asObj(drop({ characters: [stub] }).database).characters as Obj[])[0]).toBe(stub)
    })
})
