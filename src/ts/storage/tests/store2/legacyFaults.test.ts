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
import { findCharacterFaults, findLegacyFaults, isObjectLike, legacyCharactersRefused } from 'src/ts/storage/store2/legacy/faults'
import { planWholeTreeInstall } from 'src/ts/storage/store2/legacy/install'
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
        // The resolve keeps a plain-object test of its own and rewrites a Date slot to an empty object, so only the tree as read still holds the fault.
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
