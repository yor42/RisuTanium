import { describe, test, expect, vi, beforeEach } from 'vitest'
import * as fflate from 'fflate'
import type { ForageLike } from './forageBackedStore'

// Upstream's SaveKV writes one `kv:<namespace>` block (type 12) per namespace
// into a version-0 file. The fork carries those blocks verbatim in the
// `upstreamKvBlocks` field and never interprets them. Every decode mode reads
// them: default, strict and salvage. A block of type 12 whose name does not
// start with `kv:` stays an unknown block, and a file without kv blocks gains
// no field.
//
// The version-0 file is framed here, independently of production code:
// header `RISUSAVE\0`, then per block `[type][compression][nameLength][name]
// [dataLength u32 LE][data]`, with no checksums. Tests titled `reproducer:`
// fail on the sources before the decoder read type 12; `guard:` tests pass
// before and after and pin behaviour that must be preserved.
//
// Platform boundaries mocked here: the IndexedDB block cache (localforage), the
// shared storage remote blocks live in (`forageStorage`), and the platform flags.

const { cacheStore, remoteStore } = vi.hoisted(() => ({
    cacheStore: new Map<string, unknown>(),
    remoteStore: new Map<string, Uint8Array>(),
}))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async (key: string) => cacheStore.get(key) ?? null),
            setItem: vi.fn(async (key: string, value: unknown) => {
                cacheStore.set(key, value)
            }),
            removeItem: vi.fn(async (key: string) => {
                cacheStore.delete(key)
            }),
        }),
    },
}))

vi.mock(
    import('src/ts/globalApi.svelte'),
    () =>
        ({
            forageStorage: {
                keys: vi.fn(async () => Array.from(remoteStore.keys())),
                getItem: vi.fn(async (key: string) => remoteStore.get(key) ?? null),
                setItem: vi.fn(async (key: string, value: Uint8Array) => {
                    remoteStore.set(key, value)
                }),
                removeItem: vi.fn(async (key: string) => {
                    remoteStore.delete(key)
                }),
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
            getDatabase: vi.fn(() => ({})),
            presetTemplate: { name: 'test-preset' },
        }) as unknown as typeof import('src/ts/storage/database.svelte'),
)

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: true,
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    BaseDirectory: { AppData: 0 },
}))

import { RisuSaveEncoder, decodeRisuSave, listEncodedBlocks, salvageRisuSave } from '../risuSave'
import type { toSaveType } from '../risuSave'
import type { Database } from '../database.svelte'
import type { JsonValue } from '../blockFrame'

beforeEach(() => {
    cacheStore.clear()
    remoteStore.clear()
})

//#region independent version-0 framer

const encoder = new TextEncoder()

interface V0Block {
    type: number
    name: string
    payload: Uint8Array
    gzip?: boolean
    /** Sets the compression flag on a payload that is not gzip, so the block fails to inflate. */
    badGzip?: boolean
}

function jsonBlock(type: number, name: string, value: unknown, gzip = false): V0Block {
    return { type, name, payload: encoder.encode(JSON.stringify(value)), gzip }
}

function frame(block: V0Block): Uint8Array {
    const name = encoder.encode(block.name)
    const data = block.gzip === true ? fflate.gzipSync(block.payload, { mtime: 0 }) : block.payload
    const out = new Uint8Array(3 + name.length + 4 + data.length)
    out[0] = block.type
    out[1] = block.gzip === true || block.badGzip === true ? 1 : 0
    out[2] = name.length
    out.set(name, 3)
    new DataView(out.buffer).setUint32(3 + name.length, data.length, true)
    out.set(data, 3 + name.length + 4)
    return out
}

/** A version-0 file: the header, the blocks, then the root block naming every block in its directory. */
function v0File(
    blocks: V0Block[],
    directory: string[] = blocks.map((block) => block.name),
    options: { rootKv?: unknown, rootFirst?: boolean, noDirectory?: boolean } = {},
): Uint8Array {
    const root = jsonBlock(1, 'root', {
        formatversion: 5,
        botPresetsId: 0,
        someSetting: 'kept',
        ...('rootKv' in options ? { upstreamKvBlocks: options.rootKv } : {}),
        ...(options.noDirectory === true ? {} : { __directory: directory }),
    })
    const ordered = options.rootFirst === true ? [root, ...blocks] : [...blocks, root]
    const parts = [encoder.encode('RISUSAVE\x00'), ...ordered.map(frame)]
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
    let offset = 0
    for (const part of parts) {
        out.set(part, offset)
        offset += part.length
    }
    return out
}

//#endregion

//#region fixtures

/** Namespace contents in SaveKV's own layout; the fork treats each as opaque JSON. */
const NS_ALPHA = {
    version: 1,
    entries: [
        { k: 'nested', v: { list: [1, { deep: null }, 'x'], flag: true, n: 2.5 } },
        { k: '한글키🙂', v: '값' },
        { k: '0', v: [] },
    ],
}
const NS_JAPANESE = { version: 1, entries: [{ k: 'k', v: { a: { b: { c: [false] } } } }] }
const NS_PROTO = { version: 1, entries: [{ k: 'polluted', v: true }] }

const KV_NAMESPACES = ['alpha', 'ネーム', '__proto__']

function kvBlocks(): V0Block[] {
    return [
        jsonBlock(12, 'kv:alpha', NS_ALPHA),
        jsonBlock(12, 'kv:ネーム', NS_JAPANESE, true),
        jsonBlock(12, 'kv:__proto__', NS_PROTO),
    ]
}

function valueOf(field: Record<string, JsonValue> | undefined, namespace: string): JsonValue | undefined {
    return field === undefined ? undefined : Object.getOwnPropertyDescriptor(field, namespace)?.value as JsonValue | undefined
}

type Mode = 'default' | 'strict' | 'salvage'

const MODES: Mode[] = ['default', 'strict', 'salvage']

async function decodeIn(mode: Mode, file: Uint8Array): Promise<{ db: Database, omitted: Map<string, { kind: string }> }> {
    if (mode === 'salvage') {
        return await salvageRisuSave(file)
    }
    return { db: await decodeRisuSave(file, { strict: mode === 'strict' }), omitted: new Map() }
}

function kvOf(db: Database): Record<string, JsonValue> | undefined {
    return (db as Database & { upstreamKvBlocks?: Record<string, JsonValue> }).upstreamKvBlocks
}

//#endregion

describe.each(MODES)('a version-0 file with kv blocks, %s mode', (mode) => {
    test('reproducer: every namespace decodes into the field with equal values', async () => {
        const { db, omitted } = await decodeIn(mode, v0File([...kvBlocks(), jsonBlock(0, 'config', { version: 1 })]))

        expect([...omitted.keys()]).toEqual([])
        const field = kvOf(db)
        expect(Object.keys(field ?? {})).toEqual(KV_NAMESPACES)
        expect(valueOf(field, 'alpha')).toEqual(NS_ALPHA)
        expect(valueOf(field, 'ネーム')).toEqual(NS_JAPANESE)
        expect(valueOf(field, '__proto__')).toEqual(NS_PROTO)
    })

    test('reproducer: the __proto__ namespace is an own key and reaches no prototype', async () => {
        const { db } = await decodeIn(mode, v0File(kvBlocks()))

        const field = kvOf(db)!
        expect(Object.getPrototypeOf(field)).toBe(Object.prototype)
        expect(Object.getOwnPropertyDescriptor(field, '__proto__')?.enumerable).toBe(true)
        expect(({} as Record<string, unknown>).polluted).toBeUndefined()
        expect((field as Record<string, unknown>).polluted).toBeUndefined()
    })

    test('the rest of the file decodes as before (guard in the default and salvage modes, reproducer in strict)', async () => {
        const { db } = await decodeIn(mode, v0File(kvBlocks()))

        expect((db as unknown as { someSetting: string }).someSetting).toBe('kept')
        expect(db.botPresets).toEqual([{ name: 'test-preset' }])
    })

    test('guard: a file without kv blocks has no field, not even an undefined one', async () => {
        const { db } = await decodeIn(mode, v0File([jsonBlock(0, 'config', { version: 1 })]))

        expect('upstreamKvBlocks' in db).toBe(false)
    })
})

describe('a kv block whose content is not JSON', () => {
    const files = (): Uint8Array => v0File([
        jsonBlock(12, 'kv:good', NS_ALPHA),
        { type: 12, name: 'kv:bad', payload: encoder.encode('not json {') },
    ])

    test('reproducer: the default mode omits that block and keeps the others', async () => {
        const { db } = await decodeIn('default', files())

        expect(Object.keys(kvOf(db) ?? {})).toEqual(['good'])
        expect(valueOf(kvOf(db), 'good')).toEqual(NS_ALPHA)
    })

    test('reproducer: the strict mode rejects the decode with the parse failure, not as an unknown type', async () => {
        const error: unknown = await decodeIn('strict', files()).then(() => null, (thrown: unknown) => thrown)

        expect(error).toBeInstanceOf(SyntaxError)
        expect((error as SyntaxError).message).not.toMatch(/Not Implemented/)
    })

    test('reproducer: the salvage mode lists only that block, as other, and keeps the others', async () => {
        const { db, omitted } = await decodeIn('salvage', files())

        expect([...omitted.entries()].map(([name, block]) => [name, block.kind])).toEqual([['kv:bad', 'other']])
        expect(Object.keys(kvOf(db) ?? {})).toEqual(['good'])
    })

    test('guard: a file whose only kv block is unreadable has no field', async () => {
        const file = v0File([{ type: 12, name: 'kv:bad', payload: encoder.encode('') }])

        for (const mode of ['default', 'salvage'] as const) {
            const { db } = await decodeIn(mode, file)
            expect('upstreamKvBlocks' in db, mode).toBe(false)
        }
    })
})

describe('the field in root and in kv blocks: blocks win, whatever the block order', () => {
    const ROOT_FIELD = { a: { version: 1, entries: [{ k: 'stale', v: 1 }] }, 'root-only': { version: 1, entries: [] } }
    const FRESH_A = { version: 1, entries: [{ k: 'fresh', v: 2 }] }
    const damagedA = (): V0Block => ({ type: 12, name: 'kv:a', payload: encoder.encode('not gzip'), badGzip: true })

    const badJsonA = (): V0Block => ({ type: 12, name: 'kv:a', payload: encoder.encode('not json {') })

    async function rejection(file: Uint8Array): Promise<Error> {
        const error: unknown = await decodeIn('strict', file).then(() => null, (thrown: unknown) => thrown)
        expect(error).toBeInstanceOf(Error)
        return error as Error
    }

    // Upstream's own export has no `__directory` in root, so the header of each block alone has to decide; with a
    // directory, the directory names decide as well.
    describe.each([
        { layout: 'upstream layout, no directory', directory: false },
        { layout: 'directory lists every block', directory: true },
    ])('$layout', ({ directory }) => {
        const file = (blocks: V0Block[], rootFirst: boolean): Uint8Array => v0File(
            blocks,
            directory ? undefined : [],
            { rootKv: ROOT_FIELD, rootFirst, noDirectory: !directory },
        )

        describe.each(MODES)('%s mode', (mode) => {
            test.each([true, false])('reproducer: with root first = %s the blocks are the whole field and the root-only namespace is dropped', async (rootFirst) => {
                const { db } = await decodeIn(mode, file([jsonBlock(12, 'kv:a', FRESH_A)], rootFirst))

                expect(Object.keys(kvOf(db) ?? {})).toEqual(['a'])
                expect(valueOf(kvOf(db), 'a')).toEqual(FRESH_A)
            })

            test.each([true, false])('with root first = %s a damaged kv block leaves no stale copy from root (reproducer in default and salvage, guard in strict)', async (rootFirst) => {
                const damaged = file([damagedA(), jsonBlock(12, 'kv:b', NS_JAPANESE)], rootFirst)

                if (mode === 'strict') {
                    expect((await rejection(damaged)).message).not.toMatch(/Not Implemented/)
                    return
                }
                const { db, omitted } = await decodeIn(mode, damaged)

                expect(Object.keys(kvOf(db) ?? {})).toEqual(['b'])
                if (mode === 'salvage') {
                    expect(omitted.get('kv:a')?.kind).toBe('other')
                }
            })

            test.each([true, false])('with root first = %s every kv block damaged leaves the field absent (reproducer in default and salvage, guard in strict)', async (rootFirst) => {
                const damaged = file([damagedA()], rootFirst)

                if (mode === 'strict') {
                    expect((await rejection(damaged)).message).not.toMatch(/Not Implemented/)
                    return
                }
                const { db } = await decodeIn(mode, damaged)

                expect('upstreamKvBlocks' in db).toBe(false)
            })

            test.each([true, false])('with root first = %s a kv block of bad JSON alone leaves the field absent (reproducer in default and salvage, strict anchored to the parse failure)', async (rootFirst) => {
                const bad = file([badJsonA()], rootFirst)

                if (mode === 'strict') {
                    expect(await rejection(bad)).toBeInstanceOf(SyntaxError)
                    return
                }
                const { db } = await decodeIn(mode, bad)

                expect('upstreamKvBlocks' in db).toBe(false)
            })
        })
    })

    describe.each(MODES)('%s mode', (mode) => {
        test('a kv name only the directory lists still discards the root value (reproducer in default and salvage, guard in strict)', async () => {
            const listed = v0File([], ['kv:gone'], { rootKv: ROOT_FIELD, rootFirst: true })

            if (mode === 'strict') {
                expect((await rejection(listed)).message).toMatch(/Directory block "kv:gone" is not present/)
                return
            }
            const { db } = await decodeIn(mode, listed)

            expect('upstreamKvBlocks' in db).toBe(false)
        })

        test('reproducer: a remote pointer whose inner type is KV counts as a kv block', async () => {
            remoteStore.set('remotes/kv:r.local.bin', encoder.encode(JSON.stringify(FRESH_A)))
            const pointer = jsonBlock(6, 'pointer', { v: 1, type: 12, name: 'kv:r' })

            const { db } = await decodeIn(mode, v0File([pointer], undefined, { rootKv: ROOT_FIELD, rootFirst: true, noDirectory: true }))

            expect(Object.keys(kvOf(db) ?? {})).toEqual(['r'])
            expect(valueOf(kvOf(db), 'r')).toEqual(FRESH_A)
        })

        test('guard: a file with the field in root and no kv block keeps the root value', async () => {
            const file = v0File([], undefined, { rootKv: ROOT_FIELD })

            const { db } = await decodeIn(mode, file)

            expect(kvOf(db)).toEqual(ROOT_FIELD)
        })

        test('reproducer: a namespace in two blocks takes the later block', async () => {
            const file = v0File([
                jsonBlock(12, 'kv:a', NS_ALPHA),
                jsonBlock(12, 'kv:a', FRESH_A),
            ], ['kv:a'])

            const { db } = await decodeIn(mode, file)

            expect(Object.keys(kvOf(db) ?? {})).toEqual(['a'])
            expect(valueOf(kvOf(db), 'a')).toEqual(FRESH_A)
        })
    })
})

describe('a type 12 block that is not named kv:', () => {
    const file = (): Uint8Array => v0File([jsonBlock(12, 'stranger', { version: 1, entries: [] })])

    test('guard: the default mode drops it as an unknown block and adds no field', async () => {
        const { db } = await decodeIn('default', file())

        expect('upstreamKvBlocks' in db).toBe(false)
    })

    test('guard: the strict mode rejects it as an unknown block', async () => {
        await expect(decodeIn('strict', file())).rejects.toThrow(/Not Implemented RisuSaveType: 12 for stranger/)
    })

    test('guard: the salvage mode lists it as other and adds no field', async () => {
        const { db, omitted } = await decodeIn('salvage', file())

        expect([...omitted.entries()].map(([name, block]) => [name, block.kind])).toEqual([['stranger', 'other']])
        expect('upstreamKvBlocks' in db).toBe(false)
    })
})

describe('a kv block the directory names but the file lacks', () => {
    test('reproducer: salvage lists it as other, not as a missing character', async () => {
        const { omitted } = await salvageRisuSave(v0File([], ['kv:gone']))

        expect(omitted.get('kv:gone')?.kind).toBe('other')
    })

    test('guard: a missing block that is not a kv namespace is still a character', async () => {
        const { omitted } = await salvageRisuSave(v0File([], ['some-character']))

        expect(omitted.get('some-character')?.kind).toBe('character')
    })

    test('guard: strict rejects it', async () => {
        await expect(decodeRisuSave(v0File([], ['kv:gone']), { strict: true })).rejects.toThrow(/Directory block "kv:gone" is not present/)
    })
})

describe('the field in the fork\'s own block store', () => {
    function makeToSave(): toSaveType {
        return { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    }

    function databaseWith(field: Record<string, JsonValue>): Database {
        return {
            formatversion: 5,
            botPresetsId: 0,
            botPresets: [{ name: 'Preset' }],
            modules: [],
            loadouts: [],
            plugins: [],
            pluginCustomStorage: {},
            characters: [{ chaId: 'kv-carry-0', type: 'character', name: 'Zero', chats: [] }],
            upstreamKvBlocks: field,
        } as unknown as Database
    }

    test('guard: the field rides in the root block through init and survives a strict decode, with its namespaces intact', async () => {
        const field = JSON.parse(JSON.stringify({ alpha: NS_ALPHA, 'ネーム': NS_JAPANESE })) as Record<string, JsonValue>
        const db = databaseWith(field)
        const encoded = new RisuSaveEncoder()
        await encoded.init(db, { compression: false })

        const decoded = await decodeRisuSave(new Uint8Array(encoded.encode()!), { strict: true })

        expect(kvOf(decoded)).toEqual(field)
    })

    test('guard: a later change to the field is rewritten into the root block by set', async () => {
        const db = databaseWith({ alpha: NS_ALPHA as unknown as JsonValue })
        const encoded = new RisuSaveEncoder()
        await encoded.init(db, { compression: false })

        db.upstreamKvBlocks = { alpha: { version: 1, entries: [{ k: 'changed', v: 1 }] } }
        await encoded.set(db, makeToSave())
        const decoded = await decodeRisuSave(new Uint8Array(encoded.encode()!), { strict: true })

        expect(kvOf(decoded)).toEqual({ alpha: { version: 1, entries: [{ k: 'changed', v: 1 }] } })
    })

    test('guard: the encoder emits no type 12 block for the field', async () => {
        const db = databaseWith({ alpha: NS_ALPHA as unknown as JsonValue })
        const encoded = new RisuSaveEncoder()
        await encoded.init(db, { compression: false })

        const written = listEncodedBlocks(new Uint8Array(encoded.encode()!))
        expect(written.filter((block) => block.type === 12 || block.name.startsWith('kv:'))).toEqual([])
    })
})
