import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ForageLike } from './forageBackedStore'

//#region module mocks -- the same set risuSaveDuplicateChaId.test.ts uses.

const { store, cacheSetItem, cacheGetItem, cacheRemoveItem } = vi.hoisted(() => {
    const store = new Map<string, unknown>()
    return {
        store,
        cacheSetItem: vi.fn(async (key: string, value: unknown) => {
            store.set(key, value)
        }),
        cacheGetItem: vi.fn(async (key: string) => store.get(key) ?? null),
        cacheRemoveItem: vi.fn(async (key: string) => {
            store.delete(key)
        }),
    }
})

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: cacheGetItem,
            setItem: cacheSetItem,
            removeItem: cacheRemoveItem,
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
                setItem: vi.fn(async () => {}),
            },
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

import { RisuSaveEncoder } from '../risuSave'
import type { SaveLayout, toSaveType } from '../risuSave'
import type { Database } from '../database.svelte'

beforeEach(() => {
    store.clear()
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
})

afterEach(() => {
    vi.restoreAllMocks()
})

type Entry = Record<string, unknown>

function character(chaId: unknown, extra: Entry = {}): Entry {
    return { chaId, type: 'character', name: `name ${String(chaId).slice(0, 8)}`, chats: [{ message: [{ role: 'char', data: 'hi' }] }], ...extra }
}

function tree(characters: unknown, over: Entry = {}): Database {
    return {
        formatversion: 5,
        botPresets: [{ name: 'preset one' }],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characters,
        ...over,
    } as unknown as Database
}

function nothingMarked(): toSaveType {
    return { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
}

/** What a restore does with a tree: a fresh encoder, `init` then `set` with no marks. */
async function encodeTree(db: Database): Promise<{ encoder: RisuSaveEncoder, layout: SaveLayout }> {
    const encoder = new RisuSaveEncoder()
    await encoder.init(db, { compression: false })
    await encoder.set(db, nothingMarked())
    const layout = encoder.snapshotLayout()
    if (layout === null) {
        throw new Error('the encoder produced no layout')
    }
    return { encoder, layout }
}

function sameLayout(a: SaveLayout, b: SaveLayout): boolean {
    if (a.keys.length !== b.keys.length) {
        return false
    }
    for (let i = 0; i < a.keys.length; i++) {
        if (a.keys[i] !== b.keys[i] || !Buffer.from(a.blocks[i]).equals(Buffer.from(b.blocks[i]))) {
            return false
        }
    }
    return true
}

function blockText(layout: SaveLayout, key: string): string {
    const index = layout.keys.indexOf(key)
    if (index < 0) {
        return '<no block>'
    }
    const bytes = layout.blocks[index]
    const nameLength = bytes[2]
    const dataStart = 3 + nameLength + 4 + 4
    const length = new DataView(bytes.buffer, bytes.byteOffset + 3 + nameLength, 4).getUint32(0, true)
    return new TextDecoder().decode(bytes.subarray(dataStart, dataStart + length))
}

const BAD_IDS: Array<[string, unknown]> = [
    ['an empty string', ''],
    ['undefined', undefined],
    ['preset', 'preset'],
    ['__proto__', '__proto__'],
    ['a Symbol', Symbol('id')],
    ['300 characters', 'x'.repeat(300)],
    ['a lone surrogate', 'a\ud800b'],
    ['an object', {}],
    ['Infinity', Infinity],
]

describe('entries and ids the encoder leaves out (regression: S1, S2, S3 class at the encoder)', () => {
    test.each(BAD_IDS)('a character whose id is %s gets no block and the layout equals the layout without it', async (_label, badId) => {
        const good = await encodeTree(tree([character('a'), character('b')]))
        const withBad = await encodeTree(tree([character('a'), character(badId), character('b')]))
        expect(withBad.layout.keys).toEqual(good.layout.keys)
        expect(sameLayout(withBad.layout, good.layout)).toBe(true)
    })

    test.each([
        ['a number', 5],
        ['null', null],
        ['an array', []],
        ['a string', 'text'],
    ])('an entry that is %s gets no block and the layout equals the layout without it', async (_label, junk) => {
        const good = await encodeTree(tree([character('a'), character('b')]))
        const withJunk = await encodeTree(tree([character('a'), junk, character('b')]))
        expect(sameLayout(withJunk.layout, good.layout)).toBe(true)
    })

    test('a marked holder whose id is a block name does not replace that block', async () => {
        const db = tree([character('a'), character('config')])
        const clean = await encodeTree(tree([character('a')]))
        const encoder = new RisuSaveEncoder()
        await encoder.init(db, { compression: false })
        const toSave = nothingMarked()
        toSave.character = ['config']
        await encoder.set(db, toSave)
        const layout = encoder.snapshotLayout()!
        expect(layout.keys).toEqual(clean.layout.keys)
        expect(blockText(layout, 'config')).toBe('{"version":1}')
    })
})

describe('marks (regression: S4)', () => {
    test('marks naming fixed blocks delete nothing', async () => {
        const db = tree([character('a'), character('b')])
        const { encoder, layout: before } = await encodeTree(db)
        const toSave = nothingMarked()
        toSave.character = ['config', 'preset', 'root', 'modules']
        await encoder.set(db, toSave)
        const after = encoder.snapshotLayout()
        expect(after).not.toBeNull()
        expect(after!.keys).toEqual(before.keys)
    })

    test('a Symbol mark neither throws nor deletes', async () => {
        const db = tree([character('a'), character('b')])
        const { encoder, layout: before } = await encodeTree(db)
        const toSave = nothingMarked()
        toSave.character = [Symbol('mark') as unknown as string]
        await expect(encoder.set(db, toSave)).resolves.toBeUndefined()
        expect(encoder.snapshotLayout()!.keys).toEqual(before.keys)
    })

    test('a mark for a saved character that is gone still deletes its block (guard: removal is intentional)', async () => {
        const db = tree([character('a'), character('b')])
        const { encoder } = await encodeTree(db)
        const smaller = tree([character('a')])
        const toSave = nothingMarked()
        toSave.character = ['b']
        await encoder.set(smaller, toSave)
        expect(encoder.snapshotLayout()!.keys).not.toContain('b')
    })
})

describe('an id changed between the snapshot and the serialization (regression: S18)', () => {
    test('the block keeps its bytes, the mark stays and the renamed form is not stored', async () => {
        const a = character('a')
        const b = character('b')
        const db = tree([a, b])
        const { encoder, layout: before } = await encodeTree(db)
        const savedBlockOfA = before.blocks[before.keys.indexOf('a')]
        Object.defineProperty(a, 'toJSON', {
            configurable: true,
            enumerable: false,
            value() {
                a.chaId = 'config'
                return { ...(this as Entry), chaId: 'config' }
            },
        })
        const toSave = nothingMarked()
        toSave.character = ['a']
        await encoder.set(db, toSave)
        const after = encoder.snapshotLayout()!
        expect(after.blocks[after.keys.indexOf('a')]).toBe(savedBlockOfA)
        expect(after.keys).toEqual(before.keys)
        expect(toSave.character).toEqual(['a'])
    })

    test('init leaves the holder out and builds no block for it', async () => {
        const a = character('a')
        Object.defineProperty(a, 'toJSON', {
            configurable: true,
            enumerable: false,
            value() {
                a.chaId = 'preset'
                return { ...(this as Entry), chaId: 'preset' }
            },
        })
        const encoder = new RisuSaveEncoder()
        await encoder.init(tree([a, character('b')]), { compression: false })
        expect(encoder.snapshotLayout()!.keys).not.toContain('a')
        expect(encoder.snapshotLayout()!.keys).toContain('b')
    })
})

describe('serialized form of a character (regression: S8)', () => {
    test.each([
        ['5', () => 5],
        ['undefined', () => undefined],
        ['an array', () => []],
    ])('toJSON returning %s parks with a named error before anything is stored', async (_label, produce) => {
        const odd = character('odd')
        Object.defineProperty(odd, 'toJSON', { configurable: true, enumerable: false, value: produce })
        const encoder = new RisuSaveEncoder()
        await expect(encoder.init(tree([character('a'), odd]), { compression: false })).rejects.toMatchObject({ kind: 'character-not-object' })
    })
})

describe('containers (regression: S7)', () => {
    test.each(['modules', 'loadouts', 'plugins'] as const)('%s undefined or null encodes as an empty list', async (container) => {
        for (const missing of [undefined, null]) {
            const db = tree([character('a')], { [container]: missing })
            const encoder = new RisuSaveEncoder()
            await encoder.init(db, { compression: false })
            await encoder.set(db, { ...nothingMarked(), [container]: true })
            const key = container
            expect(blockText(encoder.snapshotLayout()!, key)).toBe('[]')
        }
    })

    test('a reload init with modules undefined writes an empty list', async () => {
        const previous = (await encodeTree(tree([character('a')]))).encoder
        const encoder = new RisuSaveEncoder()
        await encoder.init(tree([character('a')], { modules: undefined }), { compression: false, previous })
        expect(blockText(encoder.snapshotLayout()!, 'modules')).toBe('[]')
    })

    test.each([
        ['modules', {}],
        ['loadouts', 'text'],
        ['plugins', 5],
        ['botPresets', undefined],
        ['botPresets', {}],
        ['characters', {}],
        ['characters', undefined],
    ])('%s holding %j parks with a named error', async (container, value) => {
        const db = tree([character('a')], { [container]: value })
        const encoder = new RisuSaveEncoder()
        await expect(encoder.init(db, { compression: false })).rejects.toMatchObject({ kind: 'container-not-list' })
    })

    test('a container turned into a non-list after init parks set() when it is written', async () => {
        const db = tree([character('a')])
        const { encoder } = await encodeTree(db)
        ;(db as unknown as Entry).modules = {}
        await expect(encoder.set(db, { ...nothingMarked(), modules: true })).rejects.toMatchObject({ kind: 'container-not-list' })
    })
})

describe('the exclusion report (unit of the new report API)', () => {
    test('init reports each excluded entry with its reason', async () => {
        const junk = 5
        const encoder = new RisuSaveEncoder()
        await encoder.init(tree([character('a'), junk, character(''), character('preset'), character('b')]), { compression: false })
        const report = encoder.getReport()
        expect(report.excluded.map((item) => item.reason)).toEqual(['not-character', 'missing-id', 'unusable-id'])
        expect(report.excluded[0].entry).toBe(junk)
    })

    test('set reports an id that changed during the serialization', async () => {
        const a = character('a')
        const db = tree([a, character('b')])
        const { encoder } = await encodeTree(db)
        Object.defineProperty(a, 'toJSON', {
            configurable: true,
            enumerable: false,
            value() {
                a.chaId = 'preset'
                return { ...(this as Entry), chaId: 'preset' }
            },
        })
        const toSave = nothingMarked()
        toSave.character = ['a']
        await encoder.set(db, toSave)
        expect(encoder.getReport().excluded).toEqual([{ entry: a, reason: 'id-changed', id: 'preset' }])
    })

    test('a clean pass reports nothing and a container that was missing is named', async () => {
        const clean = new RisuSaveEncoder()
        await clean.init(tree([character('a')]), { compression: false })
        expect(clean.getReport()).toEqual({ excluded: [], repairedContainers: [] })
        const repaired = new RisuSaveEncoder()
        await repaired.init(tree([character('a')], { modules: undefined, plugins: null }), { compression: false })
        expect(repaired.getReport().repairedContainers).toEqual(['modules', 'plugins'])
    })

    test.each(['constructor', 'toString', 'hasOwnProperty', 'valueOf'])('an id named %s keys an ordinary block in init and in set (guard: ids that Object.prototype also names)', async (name) => {
        const db = tree([character('a'), character(name)])
        const { encoder, layout } = await encodeTree(db)
        expect(layout.keys).toContain(name)
        const before = layout.blocks[layout.keys.indexOf(name)]
        const toSave = nothingMarked()
        toSave.character = [name]
        ;(db.characters[1] as unknown as Entry).name = 'edited'
        await encoder.set(db, toSave)
        const after = encoder.snapshotLayout()!
        expect(Buffer.from(after.blocks[after.keys.indexOf(name)]).equals(Buffer.from(before))).toBe(false)
        expect(blockText(after, name)).toContain('edited')
    })

    test('numeric ids are kept (guard: they key a block by String(id))', async () => {
        const { layout } = await encodeTree(tree([character(5), character('a')]))
        expect(layout.keys).toContain('5')
    })
})

describe('duplicates and idempotence (guards, pass before and after)', () => {
    test('two holders of one id still freeze that id while a junk entry is left out (S5)', async () => {
        const encoder = new RisuSaveEncoder()
        await encoder.init(tree([character('a'), 5, character('a', { name: 'second' })]), { compression: false })
        expect([...encoder.getFrozenKeys()]).toEqual(['a'])
    })

    test('a second pass with no marks stores no new bytes for any block (S6)', async () => {
        const db = tree([character('a'), 5, character('b')])
        const { encoder, layout } = await encodeTree(db)
        await encoder.set(db, nothingMarked())
        const again = encoder.snapshotLayout()!
        expect(again.keys).toEqual(layout.keys)
        for (let i = 0; i < layout.keys.length; i++) {
            expect(Buffer.from(again.blocks[i]).equals(Buffer.from(layout.blocks[i]))).toBe(true)
        }
    })
})
