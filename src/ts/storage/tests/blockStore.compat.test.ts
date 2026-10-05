/**
 * Compatibility guards between the block store core and the encoder and decoder
 * in `risuSave.ts`, which the core deliberately does not import. They pass
 * before and after any change to the core that keeps these properties; each one
 * names the property it protects:
 *
 * - a block the core frames is byte-identical to the one the encoder frames;
 * - characters, modules and presets reach the store as the encoder's exact bytes;
 * - the block store's bookkeeping never reaches the decoded database (invariant X);
 * - the `.bin` a loaded block set assembles decodes to what the encoder's own file decodes to;
 * - an ordinary commit does not ask the encoder for a whole file (invariant 7).
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ForageLike } from './forageBackedStore'

//#region module mocks, as in risuSave.test.ts (see there for the rationale)

const { cacheStore } = vi.hoisted(() => ({ cacheStore: new Map<string, unknown>() }))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async (key: string) => cacheStore.get(key) ?? null),
            setItem: vi.fn(async (key: string, value: unknown) => { cacheStore.set(key, value) }),
            removeItem: vi.fn(async (key: string) => { cacheStore.delete(key) }),
        }),
    },
}))

vi.mock(
    import('src/ts/globalApi.svelte'),
    () =>
        ({
            forageStorage: {
                keys: vi.fn(async () => []),
                getItem: vi.fn(async () => null),
                setItem: vi.fn(async () => { }),
            },
            isPlainHttpFileSrc: vi.fn(() => false),
        }) as unknown as typeof import('src/ts/globalApi.svelte'),
)

vi.mock(import('src/ts/storage/store/appStore'), async () => {
    const { appStoreModuleOver } = await import('src/ts/storage/tests/appStoreMock')
    const { forageStorage } = await import('src/ts/globalApi.svelte')
    return appStoreModuleOver(() => forageStorage as unknown as ForageLike) as unknown as typeof import('src/ts/storage/store/appStore')
})

vi.mock(
    import('src/ts/storage/database.svelte'),
    () =>
        ({
            getDatabase: vi.fn(() => { throw new Error('no live database in tests') }),
            presetTemplate: { name: 'test-preset' },
        }) as unknown as typeof import('src/ts/storage/database.svelte'),
)

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    BaseDirectory: { AppData: 0 },
}))

//#endregion

import { RisuSaveEncoder, decodeRisuSave, listEncodedBlocks } from '../risuSave'
import type { Database } from '../database.svelte'
import { frameBlock, parseFramedBlock, readPack } from '../blockFrame'
import { assembleLegacyFile, type BlockSetInput } from '../blockStore'
import { characterBlockKey, fixedBlockKey, stubsKey } from '../blockKeys'
import { createFakeStore, makeOwner, withBlock, type FakeStore } from './blockStoreHarness'

beforeEach(() => {
    cacheStore.clear()
})

type CharacterFixture = Database['characters'][number]

function makeCharacter(chaId: string, name: string): CharacterFixture {
    return { chaId, type: 'character', name, chats: [{ message: [{ role: 'user', data: `hello ${name}` }] }] } as unknown as CharacterFixture
}

function buildDb(characters: CharacterFixture[]): Database {
    return {
        formatversion: 5,
        botPresets: [{ name: 'p' }],
        botPresetsId: 0,
        modules: [{ name: 'm', id: 'm1' }],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: { a: 1 },
        mainPrompt: 'prompt',
        characters,
    } as unknown as Database
}

async function encoderFor(characters: CharacterFixture[]): Promise<{ encoder: RisuSaveEncoder, input: BlockSetInput }> {
    const db = buildDb(characters)
    const encoder = new RisuSaveEncoder()
    await encoder.init(db, { compression: false, writeBlockCache: false })
    await encoder.set(db, { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false })
    const layout = encoder.snapshotLayout()
    if (layout === null) {
        throw new Error('encoder has no layout')
    }
    return { encoder, input: { layout, packed: new Set<string>() } }
}

async function seededOwner(store: FakeStore, input: BlockSetInput) {
    const bundle = makeOwner(store)
    const result = await bundle.owner.replaceWholeState(input, { requireAbsentHead: true })
    expect(result.kind).toBe('won')
    return { ...bundle, generation: result.kind === 'won' ? result.generation : '' }
}

describe('framing is the encoder\'s (guard)', () => {
    test('every block the encoder wrote parses with the core\'s parser and frames back to the same bytes', async () => {
        const { input } = await encoderFor([makeCharacter('a', 'A'), makeCharacter('b', 'B')])
        input.layout.blocks.forEach((block, i) => {
            const parsed = parseFramedBlock(block, 0)
            expect(parsed.name).toBe(input.layout.keys[i])
            expect(parsed.end).toBe(block.length)
            expect(frameBlock(parsed.type, parsed.name, parsed.payload)).toEqual(block)
        })
    })

    test('the core\'s block list of an encoder file agrees with listEncodedBlocks', async () => {
        const { encoder } = await encoderFor([makeCharacter('a', 'A')])
        const file = new Uint8Array(encoder.encode() as ArrayBuffer)
        const names = listEncodedBlocks(file).map((block) => block.name)
        let offset = 9
        const mine: string[] = []
        while (offset < file.length) {
            const block = parseFramedBlock(file, offset)
            mine.push(block.name)
            offset = block.end
        }
        expect(mine).toEqual(names)
    })
})

describe('what reaches the store (guard)', () => {
    test('characters, modules and presets are the encoder\'s exact bytes, in their own keys or in the pack', async () => {
        const { input } = await encoderFor([makeCharacter('a', 'A'), makeCharacter('b', 'B'), makeCharacter('c', 'C')])
        const packed: BlockSetInput = { layout: input.layout, packed: new Set(['c']) }
        const store = createFakeStore({ versioned: true })
        const { generation } = await seededOwner(store, packed)
        const byName = new Map(input.layout.keys.map((key, i) => [key, input.layout.blocks[i]]))
        expect(store.peek(characterBlockKey(generation, 'a'))).toEqual(byName.get('a'))
        expect(store.peek(characterBlockKey(generation, 'b'))).toEqual(byName.get('b'))
        for (const name of ['preset', 'modules', 'loadouts', 'plugins', 'pluginStorage', 'config']) {
            expect(store.peek(fixedBlockKey(generation, name)), name).toEqual(byName.get(name))
        }
        expect(readPack(store.peek(stubsKey(generation)) as Uint8Array).found.get('c')).toEqual(byName.get('c'))
    })
})

describe('bookkeeping never reaches the database (invariant X, a guard)', () => {
    test('the root a loaded set assembles carries __directory, __packed and __seq, and the decoded database carries none', async () => {
        const { input } = await encoderFor([makeCharacter('a', 'A'), makeCharacter('b', 'B')])
        const store = createFakeStore({ versioned: false })
        await seededOwner(store, { layout: input.layout, packed: new Set(['b']) })
        const loaded = await makeOwner(store).owner.load()
        if (loaded.kind !== 'loaded') {
            throw new Error('not loaded')
        }
        expect(Object.keys(loaded.loaded.rootFields)).toEqual(expect.arrayContaining(['__directory', '__packed', '__seq']))
        const decoded = await decodeRisuSave(assembleLegacyFile(loaded.loaded), { strict: true }) as unknown as Record<string, unknown>
        for (const key of Object.keys(decoded)) {
            expect(key.startsWith('__'), key).toBe(false)
        }
        expect(Object.keys(decoded)).not.toContain('__directory')
        expect(Object.keys(decoded)).not.toContain('__packed')
        expect(Object.keys(decoded)).not.toContain('__seq')
    })

    test('the database decoded from a loaded block set equals the one decoded from the encoder\'s own file', async () => {
        const characters = [makeCharacter('a', 'A'), makeCharacter('b', 'B'), makeCharacter('c', 'C')]
        const { encoder, input } = await encoderFor(characters)
        const store = createFakeStore({ versioned: true })
        await seededOwner(store, { layout: input.layout, packed: new Set(['c']) })
        const loaded = await makeOwner(store).owner.load()
        if (loaded.kind !== 'loaded') {
            throw new Error('not loaded')
        }
        const fromBlocks = await decodeRisuSave(assembleLegacyFile(loaded.loaded), { strict: true })
        const fromEncoder = await decodeRisuSave(new Uint8Array(encoder.encode() as ArrayBuffer), { strict: true })
        expect(fromBlocks).toEqual(fromEncoder)
    })
})

describe('an ordinary commit writes only the changed blocks and the root and never asks the encoder for a whole file (invariant 7)', () => {
    test('the encoder is never asked for a whole file, and the bytes written are one character plus the root', async () => {
        const encodeSpy = vi.spyOn(RisuSaveEncoder.prototype, 'encode')
        const characters = [makeCharacter('a', 'A'), makeCharacter('b', 'B'), makeCharacter('c', 'C')]
        const db = buildDb(characters)
        const { encoder, input } = await encoderFor(characters)
        const store = createFakeStore({ versioned: false })
        const { owner } = await seededOwner(store, input)
        const start = store.ops.length
        db.characters[1] = makeCharacter('b', 'B edited')
        await encoder.set(db, { character: ['b'], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false })
        const layout = encoder.snapshotLayout()
        if (layout === null) {
            throw new Error('encoder has no layout')
        }
        const result = await owner.commitSave({ layout, packed: new Set() })
        expect(result).toMatchObject({ kind: 'committed', wrote: true })
        const written = store.ops.slice(start).filter((op) => op.kind === 'write')
        expect(written.length).toBe(2)
        expect(encodeSpy).not.toHaveBeenCalled()
        encodeSpy.mockRestore()
    })

    test('a save of the encoder\'s untouched layout after a boot writes nothing (scenario 2)', async () => {
        const { input } = await encoderFor([makeCharacter('a', 'A')])
        const store = createFakeStore({ versioned: true })
        await seededOwner(store, input)
        const booted = makeOwner(store)
        await booted.owner.load()
        const start = store.ops.length
        const { input: again } = await encoderFor([makeCharacter('a', 'A')])
        const result = await booted.owner.commitSave(again)
        expect(result).toMatchObject({ kind: 'committed', wrote: false })
        expect(store.ops.slice(start)).toEqual([])
    })

    test('a changed character from the encoder is a one-key save', async () => {
        const { input } = await encoderFor([makeCharacter('a', 'A'), makeCharacter('b', 'B')])
        const store = createFakeStore({ versioned: true })
        await seededOwner(store, input)
        const booted = makeOwner(store)
        await booted.owner.load()
        const { input: edited } = await encoderFor([makeCharacter('a', 'A'), makeCharacter('b', 'B changed')])
        const index = edited.layout.keys.indexOf('b')
        const start = store.ops.length
        await booted.owner.commitSave(withBlock(input, 'b', edited.layout.blocks[index]))
        expect(store.ops.slice(start).filter((op) => op.kind === 'write').length).toBe(2)
    })
})
