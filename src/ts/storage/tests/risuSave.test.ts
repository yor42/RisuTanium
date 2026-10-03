import { describe, test, expect, vi, beforeEach } from 'vitest'
import type { ForageLike } from './forageBackedStore'

//#region module mocks — keep the unit under test isolated from the rest of
// the app's (heavy, side-effecting) dependency graph, matching the pattern
// used in src/ts/process/files/tests/inlays.test.ts.

// `vi.hoisted` (not plain `const`s) because `vi.mock('localforage', ...)`
// below is itself hoisted above this file's own top-level statements, and its
// factory runs as soon as `risuSave.ts` (imported further down this file) is
// evaluated -- which, under ESM import hoisting, happens before plain
// `const`s here would have run. `cacheSetItem`/`cacheGetItem`/`cacheRemoveItem`
// are declared outside the `createInstance` factory (CHORE-17) so every call
// to `localforage.createInstance(...)` -- there is exactly
// one, at risuSave.ts's module load, held in its module-level
// `risuSaveCacheForage` -- hands out the SAME countable spies, and tests in
// this file can assert on them directly instead of only inspecting `store`'s
// final contents.
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
            // AV-3: getFileSrcCached calls this predicate.
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

// CHORE-17: replaces the real yield budget
// (`createYieldBudget`/`yieldToEventLoop`) with spies, so tests can count
// `maybeYield` calls directly instead of depending on real timing. Declared
// with `vi.hoisted` for the same reason as the cache spies above.
const { maybeYieldSpy, noteYieldedSpy } = vi.hoisted(() => ({
    maybeYieldSpy: vi.fn(async () => {}),
    noteYieldedSpy: vi.fn(),
}))
vi.mock(import('src/ts/storage/saveYield'), () => ({
    createYieldBudget: vi.fn(() => ({
        noteYielded: noteYieldedSpy,
        maybeYield: maybeYieldSpy,
    })),
    yieldToEventLoop: vi.fn(async () => {}),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    BaseDirectory: { AppData: 0 },
}))

//#endregion

import { RisuSaveEncoder, RisuSaveDecoder, decodeRisuSave } from '../risuSave'
import type { toSaveType } from '../risuSave'
import type { Database } from '../database.svelte'

// CHORE-17: the cache `store` and its spies are shared
// module-level state across every test in this file, so each test starts
// from a clean slate rather than one test's cached blocks leaking into
// another's assertions (or into the corruption-recovery test's cache lookup).
beforeEach(() => {
    store.clear()
    cacheSetItem.mockClear()
    cacheGetItem.mockClear()
    cacheRemoveItem.mockClear()
    maybeYieldSpy.mockClear()
    noteYieldedSpy.mockClear()
})

/** Number of times `spy` was called with `key` as its first argument. */
function callsForKey(spy: { mock: { calls: unknown[][] } }, key: string): number {
    return spy.mock.calls.filter((args) => args[0] === key).length
}

const ROOT_MARKER = 'ROOT_MARKER_XYZ'

function buildFixtureDb(): Database {
    return {
        formatversion: 5,
        marker: ROOT_MARKER,
        botPresets: [],
        botPresetsId: 0,
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characters: [
            {
                chaId: 'char1',
                type: 'character',
                name: 'Test Character',
                chats: [],
            },
        ],
    } as unknown as Database
}

/** Finds the byte offset of the UTF-8 encoding of `needle` within `haystack`. */
function findByteOffset(haystack: Uint8Array, needle: string): number {
    const needleBytes = new TextEncoder().encode(needle)
    outer: for (let i = 0; i <= haystack.length - needleBytes.length; i++) {
        for (let j = 0; j < needleBytes.length; j++) {
            if (haystack[i + j] !== needleBytes[j]) continue outer
        }
        return i
    }
    return -1
}

async function encodeFixture(): Promise<Uint8Array> {
    const encoder = new RisuSaveEncoder()
    await encoder.init(buildFixtureDb())
    const encoded = encoder.encode()
    expect(encoded).not.toBeNull()
    return new Uint8Array(encoded!)
}

describe('RisuSave per-block checksum', () => {
    test('round-trips cleanly when nothing is corrupted', async () => {
        const encoded = await encodeFixture()
        const decoded = await decodeRisuSave(encoded)
        expect(decoded.characters?.[0]?.chaId).toBe('char1')
        expect((decoded as any).marker).toBe(ROOT_MARKER)
    })

    // PIN of existing behaviour, not a fails-first test. Upstream saves can
    // carry a stray `§temp` character and user messages with a `name`
    // string (MC-083, MC-011), and `otherUser` is declared on the same
    // `Message` type; these must round-trip intact whether or not any code
    // in this fork writes those fields.
    test('a save carrying a §temp character and named messages keeps those fields through a round trip', async () => {
        const db = buildFixtureDb()
        db.characters.push({
            chaId: '§temp',
            type: 'character',
            name: 'Temp User',
            chats: [],
        } as unknown as Database['characters'][number])
        db.characters[0].chats = [
            {
                id: 'char1-chat-0',
                message: [
                    { role: 'user', data: 'hi', name: 'SomeUser', otherUser: true },
                    { role: 'user', data: 'hey', name: null },
                ],
                note: '',
                name: '',
                localLore: [],
            },
        ] as unknown as Database['characters'][number]['chats']

        const encoder = new RisuSaveEncoder()
        await encoder.init(db)
        const encoded = encoder.encode()
        expect(encoded).not.toBeNull()
        const decoded = await decodeRisuSave(new Uint8Array(encoded!))

        expect(decoded.characters?.some((c: any) => c.chaId === '§temp')).toBe(true)

        const char1 = decoded.characters?.find((c: any) => c.chaId === 'char1')
        const messages = (char1 as any)?.chats?.[0]?.message
        expect(messages?.[0]?.name).toBe('SomeUser')
        expect(messages?.[0]?.otherUser).toBe(true)
        expect(messages?.[1]?.name).toBeNull()
    })

    test('drops a corrupted non-root block instead of silently loading wrong data', async () => {
        const encoded = await encodeFixture()
        // Search for the JSON-content occurrence specifically (`"chaId":"char1"`),
        // not the bare block-name field earlier in the same block's header —
        // a character block is literally named after its own chaId, so a
        // naive search for "char1" alone finds that name field first, which
        // the checksum deliberately does NOT cover (see encodeRawBlock: the
        // checksum is computed over `databuf`, i.e. only the data payload
        // after the length field, not the preceding name field) — corrupting
        // it wouldn't exercise this feature at all.
        const marker = '"chaId":"char1"'
        const offset = findByteOffset(encoded, marker)
        expect(offset).toBeGreaterThan(-1)
        const corrupted = new Uint8Array(encoded)
        // Flip only the low bit of one ASCII letter (the 'c' in "char1",
        // landing inside the quotes, not on them) so the corrupted byte is
        // still a printable letter and the JSON stays syntactically valid —
        // this is the "bit-flip that parses fine but is silently wrong"
        // scenario item 11 exists to catch, not something JSON.parse alone
        // would already reject.
        corrupted[offset + '"chaId":"'.length] ^= 0x01
        const decoded = await decodeRisuSave(corrupted)
        // The block never parses successfully at all (checksum mismatch), so
        // `db.characters` is never even initialized — not an empty array.
        expect(decoded.characters?.some((c: any) => c.chaId === 'char1') ?? false).toBe(false)
    })

    test('root block corruption throws instead of degrading to a near-empty database', async () => {
        const encoded = await encodeFixture()
        const offset = findByteOffset(encoded, ROOT_MARKER)
        expect(offset).toBeGreaterThan(-1)
        const corrupted = new Uint8Array(encoded)
        corrupted[offset] ^= 0x01
        // Test RisuSaveDecoder directly rather than decodeRisuSave() — the
        // latter has its own pre-existing legacy-format fallback chain in its
        // outer catch, unrelated to this checksum feature, that could mask
        // whether THIS mechanism specifically detected the corruption.
        const decoder = new RisuSaveDecoder(true)
        await expect(decoder.decode(corrupted)).rejects.toThrow()
    })

    test('decodes a legacy (pre-checksum, v1) buffer with no trailing checksum expected', async () => {
        // Hand-built minimal v1-format buffer: version byte 0 (no checksum
        // trailer on any block), one ROOT block. Verifies old, already-saved
        // files from before this change keep decoding exactly as before.
        const header = new TextEncoder().encode('RISUSAVE\0')
        const name = new TextEncoder().encode('root')
        const content = JSON.stringify({ hello: 'world' })
        const dataBuf = new TextEncoder().encode(content)
        const lengthBuf = new Uint8Array(4)
        new DataView(lengthBuf.buffer).setUint32(0, dataBuf.length, true)
        const ROOT_TYPE = 1 // RisuSaveType.ROOT
        const block = new Uint8Array(2 + 1 + name.length + 4 + dataBuf.length)
        block.set([ROOT_TYPE, 0], 0)
        block.set([name.length], 2)
        block.set(name, 3)
        block.set(lengthBuf, 3 + name.length)
        block.set(dataBuf, 7 + name.length)
        const full = new Uint8Array(header.length + block.length)
        full.set(header, 0)
        full.set(block, header.length)

        const decoded: any = await decodeRisuSave(full)
        expect(decoded.hello).toBe('world')
    })

    test('corrupted framing (a block\'s name field) aborts decoding entirely rather than desyncing later blocks', async () => {
        const encoded = await encodeFixture()
        // Target the 'preset' block's own name field specifically (not its
        // content) — a byte here is covered by the HEADER checksum, not the
        // data checksum, so this exercises the framing-corruption path
        // (which must abort the whole decode, since block boundaries can no
        // longer be trusted) rather than the payload-corruption path (which
        // safely drops just one block and continues).
        const offset = findByteOffset(encoded, 'preset')
        expect(offset).toBeGreaterThan(-1)
        const corrupted = new Uint8Array(encoded)
        corrupted[offset] ^= 0x01
        const decoder = new RisuSaveDecoder(true)
        await expect(decoder.decode(corrupted)).rejects.toThrow()
    })

    test('rejects a buffer with an unrecognized format-version byte instead of silently treating it as legacy', async () => {
        const encoded = await encodeFixture()
        const versionByteOffset = 8 // right after the 8-byte "RISUSAVE" prefix
        expect(encoded[versionByteOffset]).toBe(1) // sanity check: this encoder always writes v2
        const corrupted = new Uint8Array(encoded)
        corrupted[versionByteOffset] = 2 // neither a recognized v1 (0) nor v2 (1) value
        await expect(decodeRisuSave(corrupted)).rejects.toThrow()
    })

    test('a root block whose type byte no longer says ROOT is treated as having no root at all (v1, no checksum coverage)', async () => {
        // Hand-built v1 buffer (see the legacy-decode test above) with a
        // single block that claims a non-ROOT type. Without checksums to
        // catch a corrupted type byte directly, this is exactly the
        // scenario the post-loop "was a root block actually processed"
        // invariant exists to catch — decode must still fail rather than
        // silently return an empty-but-plausible database.
        const header = new TextEncoder().encode('RISUSAVE\0')
        const name = new TextEncoder().encode('root')
        const content = JSON.stringify({ hello: 'world' })
        const dataBuf = new TextEncoder().encode(content)
        const lengthBuf = new Uint8Array(4)
        new DataView(lengthBuf.buffer).setUint32(0, dataBuf.length, true)
        const NOT_ROOT_TYPE = 5 // RisuSaveType.MODULES, not ROOT
        const block = new Uint8Array(2 + 1 + name.length + 4 + dataBuf.length)
        block.set([NOT_ROOT_TYPE, 0], 0)
        block.set([name.length], 2)
        block.set(name, 3)
        block.set(lengthBuf, 3 + name.length)
        block.set(dataBuf, 7 + name.length)
        const full = new Uint8Array(header.length + block.length)
        full.set(header, 0)
        full.set(block, header.length)

        await expect(decodeRisuSave(full)).rejects.toThrow()
    })
})

// CHORE-01 (guard): a marked
// id whose character still exists in `data.characters` is RE-ENCODED by
// set(), never deleted -- deletion (risuSave.ts's "Deleting character data"
// branch) only drops ids that are in `toSave.character` but NOT found in
// `data.characters` this pass (i.e. genuinely removed characters), never an
// id that is simply marked-and-still-present. This is the invariant CHORE-01
// leans on: marking a character "extra" (e.g. every character on a plugin
// setDatabase call, or a duplicate identity-tracker + explicit mark) is
// always safe.
describe('RisuSaveEncoder.set() — marked-but-still-present characters are re-encoded, not deleted', () => {
    function buildTwoCharacterDb(): Database {
        return {
            formatversion: 5,
            botPresets: [],
            botPresetsId: 0,
            modules: [],
            loadouts: [],
            plugins: [],
            pluginCustomStorage: {},
            characters: [
                { chaId: 'char1', type: 'character', name: 'Character One', chats: [] },
                { chaId: 'char2', type: 'character', name: 'Character Two', chats: [] },
            ],
        } as unknown as Database
    }

    function makeToSave(character: string[]): toSaveType {
        return {
            character,
            chat: [],
            botPreset: false,
            modules: false,
            loadouts: false,
            plugins: false,
            pluginCustomStorage: false,
        }
    }

    test('marking BOTH ids (one redundantly) re-encodes both; neither is deleted', async () => {
        const db = buildTwoCharacterDb()
        const encoder = new RisuSaveEncoder()
        await encoder.init(db)

        // Mutate char1 in place, then mark BOTH ids -- char2 didn't change at
        // all, so marking it here is the "extra, redundant mark" case
        // (identity tracker + explicit mark both firing, or a plugin
        // setDatabase marking every character) that must stay harmless.
        db.characters[0].name = 'Character One (edited)'
        const toSave = makeToSave(['char1', 'char2'])

        await encoder.set(db, toSave)
        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))

        const decodedChar1 = decoded.characters?.find((c: any) => c.chaId === 'char1')
        const decodedChar2 = decoded.characters?.find((c: any) => c.chaId === 'char2')
        expect(decodedChar1).toBeTruthy()
        expect(decodedChar1!.name).toBe('Character One (edited)')
        expect(decodedChar2).toBeTruthy()
        expect(decodedChar2!.name).toBe('Character Two') // unchanged, but still present -- not deleted
    })

    test('a genuinely removed character (in toSave.character but absent from data.characters) IS deleted', async () => {
        const db = buildTwoCharacterDb()
        const encoder = new RisuSaveEncoder()
        await encoder.init(db)

        // char2 removed from the live array entirely (e.g. removeChar's
        // 'permanent' path), and its id is still in toSave.character (e.g. it
        // was marked before being removed in the same save cycle).
        const dbAfterRemoval: Database = { ...db, characters: [db.characters[0]] } as unknown as Database
        const toSave = makeToSave(['char2'])

        await encoder.set(dbAfterRemoval, toSave)
        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))

        expect(decoded.characters?.find((c: any) => c.chaId === 'char2')).toBeUndefined()
        expect(decoded.characters?.find((c: any) => c.chaId === 'char1')).toBeTruthy()
    })
})

// `takeEncodedCharacterProxies()` hands the caller the recorded set AND
// resets the internal one to a fresh, empty `Set`, so each recorded proxy is
// consumed exactly once. Used once for the identity-tracker seed at boot,
// and once per reload by `prepareSaveIteration`'s post-reload filter (see
// globalApi.saveSequence.svelte.test.ts).
describe('RisuSaveEncoder.takeEncodedCharacterProxies() — consume-once proxy release', () => {
    function buildTwoCharacterDbForProxyTest(): Database {
        return {
            formatversion: 5,
            botPresets: [],
            botPresetsId: 0,
            modules: [],
            loadouts: [],
            plugins: [],
            pluginCustomStorage: {},
            characters: [
                { chaId: 'char1', type: 'character', name: 'Character One', chats: [] },
                { chaId: 'char2', type: 'character', name: 'Character Two', chats: [] },
            ],
        } as unknown as Database
    }

    test('after init() on a 2-character database, the first call returns both character objects; a second call returns an empty set', async () => {
        const db = buildTwoCharacterDbForProxyTest()
        const encoder = new RisuSaveEncoder()
        await encoder.init(db)

        const firstTake = encoder.takeEncodedCharacterProxies()
        expect(firstTake.size).toBe(2)
        expect(firstTake.has(db.characters[0])).toBe(true)
        expect(firstTake.has(db.characters[1])).toBe(true)

        const secondTake = encoder.takeEncodedCharacterProxies()
        expect(secondTake.size).toBe(0)
    })
})

// CHORE-17. A block's local
// cache write is skipped when its freshly-encoded bytes are already equal to
// the encoder's own last-written bytes for that key (`this.blocks[name]`).
// A1 pins the skip itself. A2c additionally pins that an equal-length
// change is still caught -- by choosing a name whose block length lands on
// a multiple of 4, so the whole comparison runs through the word loop, with
// no tail bytes left for a coincidental checksum difference to catch the
// change on the word loop's behalf (see A2c's own comment for why that
// distinction matters). A2 through A6 pin the behaviour the skip must not
// disturb -- a changed character still writes, a failed write is still
// retried, a round trip through encode/decode still matches, a corrupted
// block still recovers from the cache, and a fresh encoder still writes
// every block. A9 pins that a run of skips still yields to the event loop,
// awaiting each yield before encoding the next block; A10 pins that a real
// (non-skipped) write still resets the yield budget via `noteYielded`.
describe('RisuSaveEncoder — CHORE-17, the local cache skip', () => {
    function buildOneCharacterDb(name = 'Test Character'): Database {
        return {
            formatversion: 5,
            botPresets: [],
            botPresetsId: 0,
            modules: [],
            loadouts: [],
            plugins: [],
            pluginCustomStorage: {},
            characters: [
                { chaId: 'char1', type: 'character', name, chats: [] },
            ],
        } as unknown as Database
    }

    function makeToSave(character: string[]): toSaveType {
        return {
            character,
            chat: [],
            botPreset: false,
            modules: false,
            loadouts: false,
            plugins: false,
            pluginCustomStorage: false,
        }
    }

    test('A1 (red): an unchanged, marked character is not rewritten to the cache the second time set() runs', async () => {
        const db = buildOneCharacterDb()
        const encoder = new RisuSaveEncoder()
        await encoder.init(db)

        await encoder.set(db, makeToSave(['char1']))
        const countAfterFirstSet = callsForKey(cacheSetItem, 'risuSaveBlock_char1')

        await encoder.set(db, makeToSave(['char1']))
        const countAfterSecondSet = callsForKey(cacheSetItem, 'risuSaveBlock_char1')

        expect(countAfterSecondSet).toBe(countAfterFirstSet)
    })

    test('A2 (guard): a changed character is written, and its cache entry holds the new data', async () => {
        const db = buildOneCharacterDb()
        const encoder = new RisuSaveEncoder()
        await encoder.init(db)

        db.characters[0].name = 'Changed Name'
        await encoder.set(db, makeToSave(['char1']))

        const cached = store.get('risuSaveBlock_char1') as { data: string }
        expect(JSON.parse(cached.data).name).toBe('Changed Name')
    })

    test('A2b (guard, equal length): a character change that keeps the same byte length is still written', async () => {
        const db = buildOneCharacterDb('Test Character')
        const encoder = new RisuSaveEncoder()
        await encoder.init(db)
        cacheSetItem.mockClear()

        // Same length as 'Test Character' -- pins that the skip compares
        // content, not just length. A comparator that only checked
        // `a.length === b.length` would wrongly treat this as unchanged.
        db.characters[0].name = 'Test CharacteR'
        await encoder.set(db, makeToSave(['char1']))

        const call = cacheSetItem.mock.calls.find((args) => args[0] === 'risuSaveBlock_char1')
        expect(call).toBeTruthy()
        expect(JSON.parse((call![1] as { data: string }).data).name).toBe('Test CharacteR')
    })

    /**
     * Mirrors encodeRawBlock's own framing math (headerBytes(2+1+nameLen+4) +
     * headerChecksum(4) + databuf + dataChecksum(4)) so the fixture below can
     * assert its own block length instead of hard-coding a number that would
     * go stale silently if that framing ever changed.
     */
    function characterBlockLength(chaId: string, character: unknown): number {
        const nameBufLen = new TextEncoder().encode(chaId).length
        const databufLen = new TextEncoder().encode(JSON.stringify(character)).length
        return (2 + 1 + nameBufLen + 4) + 4 + databufLen + 4
    }

    test('A2c (guard, word-aligned): an equal-length change is still written when the block length is a multiple of 4', async () => {
        // Guards specifically against the `aWords[i] !== bWords[i]` word
        // check: a block with trailing bytes could still catch a content
        // difference via the tail-byte comparison instead (coincidentally
        // including a byte of the CRC32 checksum, which differs whenever the
        // content does), so only a block length that is an exact multiple of
        // 4, leaving zero trailing bytes, forces the word loop itself to
        // catch the difference.
        const before = buildOneCharacterDb('Multiple4Length')
        const after = buildOneCharacterDb('Multiple4LengtH') // same length as 'Multiple4Length'
        expect(characterBlockLength('char1', before.characters[0])).toBe(
            characterBlockLength('char1', after.characters[0]),
        )
        expect(characterBlockLength('char1', before.characters[0]) % 4).toBe(0)

        const encoder = new RisuSaveEncoder()
        await encoder.init(before)
        cacheSetItem.mockClear()

        await encoder.set(after, makeToSave(['char1']))

        const call = cacheSetItem.mock.calls.find((args) => args[0] === 'risuSaveBlock_char1')
        expect(call).toBeTruthy()
        expect(JSON.parse((call![1] as { data: string }).data).name).toBe('Multiple4LengtH')
    })

    test('A3 (guard): after a change, a set() whose cache write throws is retried by the next set() and ends up with the new data', async () => {
        const db = buildOneCharacterDb()
        const encoder = new RisuSaveEncoder()
        await encoder.init(db)

        db.characters[0].name = 'First Change'
        cacheSetItem.mockImplementationOnce(async () => {
            throw new Error('write failed')
        })
        await expect(encoder.set(db, makeToSave(['char1']))).rejects.toThrow('write failed')

        db.characters[0].name = 'Second Change'
        await encoder.set(db, makeToSave(['char1']))

        const cached = store.get('risuSaveBlock_char1') as { data: string }
        expect(JSON.parse(cached.data).name).toBe('Second Change')
    })

    test('A4 (guard): a round trip through encode and decode still yields identical data after skip-worthy repeated set() calls', async () => {
        const db = buildOneCharacterDb()
        const encoder = new RisuSaveEncoder()
        await encoder.init(db)

        await encoder.set(db, makeToSave(['char1'])) // unchanged
        await encoder.set(db, makeToSave(['char1'])) // unchanged again
        db.characters[0].name = 'Changed For Round Trip'
        await encoder.set(db, makeToSave(['char1'])) // changed

        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))
        expect(decoded.characters?.[0]?.name).toBe('Changed For Round Trip')
    })

    test('A5 (guard, recovery): a corrupted character data checksum recovers the right content from the cache', async () => {
        const db = buildOneCharacterDb()
        const encoder = new RisuSaveEncoder()
        await encoder.init(db)
        // set() (not just init()) is required here: init()'s root block has no
        // `__directory` field at all, so nothing would trigger the cache
        // fallback below -- only set() adds `__directory`, which is what
        // RisuSaveDecoder consults to decide whether to load a missing block
        // from the cache (plan fact 3).
        await encoder.set(db, makeToSave(['char1']))

        const encoded = new Uint8Array(encoder.encode()!)
        const marker = '"chaId":"char1"'
        const offset = findByteOffset(encoded, marker)
        expect(offset).toBeGreaterThan(-1)
        const corrupted = new Uint8Array(encoded)
        // Flips a data byte (inside the quoted chaId value), which fails only
        // the per-block DATA checksum, not the header/length -- the header
        // stays intact, so the decoder still knows where this block ends and
        // simply drops it, instead of aborting the whole decode.
        corrupted[offset + '"chaId":"'.length] ^= 0x01

        const decoded = await decodeRisuSave(corrupted)
        const recovered = decoded.characters?.find((c: any) => c.chaId === 'char1')
        expect(recovered).toBeTruthy()
        expect(recovered!.name).toBe('Test Character')
    })

    test('A6 (guard): after a fresh encoder\'s init(), every block is written', async () => {
        const db = buildOneCharacterDb()
        const encoder = new RisuSaveEncoder()
        await encoder.init(db)

        const writtenKeys = cacheSetItem.mock.calls.map((args) => args[0]).sort()
        expect(writtenKeys).toEqual([
            'risuSaveBlock_char1',
            'risuSaveBlock_config',
            'risuSaveBlock_loadouts',
            'risuSaveBlock_modules',
            'risuSaveBlock_pluginStorage',
            'risuSaveBlock_plugins',
            'risuSaveBlock_preset',
            'risuSaveBlock_root',
        ])
    })

    test('A9: calls maybeYield once per skipped write', async () => {
        const characterCount = 5
        // toJSON hooks the one `JSON.stringify(character)` call set() makes
        // per character, so `order` records exactly when each character's
        // block starts encoding, without touching any non-test file.
        const order: string[] = []
        const db: Database = {
            formatversion: 5,
            botPresets: [],
            botPresetsId: 0,
            modules: [],
            loadouts: [],
            plugins: [],
            pluginCustomStorage: {},
            characters: Array.from({ length: characterCount }, (_, i) => ({
                chaId: `skip-heavy-${i}`,
                type: 'character',
                name: `Character ${i}`,
                chats: [],
                toJSON() {
                    order.push(this.chaId)
                    return { chaId: this.chaId, type: this.type, name: this.name, chats: this.chats }
                },
            })),
        } as unknown as Database
        const encoder = new RisuSaveEncoder()
        await encoder.init(db)
        order.length = 0 // init() also encodes every character; only set()'s order matters here

        // Holds the first maybeYield() call pending, so the test can tell
        // whether set() actually awaits it before moving on to the next
        // character's block, rather than merely calling it.
        let resolveFirstYield!: () => void
        const firstYield = new Promise<void>((resolve) => {
            resolveFirstYield = resolve
        })
        maybeYieldSpy.mockImplementationOnce(async () => {
            await firstYield
        })

        // Every character is marked but none of them changed since init(), so
        // every one of these writes is skip-worthy.
        const setPromise = encoder.set(db, makeToSave(db.characters.map((c) => c.chaId)))

        // Flush several microtask turns while the first maybeYield() call
        // stays pending. If set() awaits it (as it must), execution stays
        // blocked on the first character; only a version that fired
        // maybeYield without awaiting it would let later characters encode
        // during this window.
        for (let i = 0; i < 5; i++) {
            await Promise.resolve()
        }
        expect(order).toEqual(['skip-heavy-0'])
        expect(maybeYieldSpy).toHaveBeenCalledTimes(1)

        resolveFirstYield()
        await setPromise

        expect(order).toEqual(db.characters.map((c) => c.chaId))
        expect(maybeYieldSpy).toHaveBeenCalledTimes(characterCount)
    })

    test('A10 (guard): a real (non-skipped) write calls noteYielded', async () => {
        const db = buildOneCharacterDb()
        const encoder = new RisuSaveEncoder()
        await encoder.init(db)
        noteYieldedSpy.mockClear()

        db.characters[0].name = 'Changed For NoteYielded'
        await encoder.set(db, makeToSave(['char1']))

        expect(noteYieldedSpy).toHaveBeenCalled()
    })
})
