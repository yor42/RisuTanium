import { describe, test, expect, vi, beforeEach } from 'vitest'
import type { ForageLike } from './forageBackedStore'

// Separate from risuSave.test.ts because remote-block encoding requires
// isNodeServer/isTauri to be true (eligibility gate in encodeBlock()) and a
// database with enableRemoteSaving explicitly set — a different mock shape
// than the base fixture file uses, so this stays a dedicated module-mocked
// suite rather than trying to toggle the existing one per-test.

const remoteStore = new Map<string, Uint8Array>()

// risuSave.ts's module-level `checkedRemoteExistence` (not exported, so it
// can't be reset per test the way `remoteStore` below is) persists across
// every test in this file: a real write, or a confirmed existence check,
// marks its content-addressed filename there for the rest of the run. Every
// test below must therefore use content no earlier test in this file has
// already written under the same chaId -- reusing it would make the write
// look already-confirmed and get silently skipped.
// `vi.hoisted` (not a plain `const`) for the same reason as risuSave.test.ts:
// `vi.mock('localforage', ...)` is a plain-string mock, which is hoisted
// above this file's own top-level statements, and its factory runs as soon
// as `risuSave.ts` (imported further down this file) is evaluated -- under
// ESM import hoisting, before a plain `const` here would have run.
// `localCacheSetItem` is declared outside the `createInstance` factory
// (CHORE-17) so tests can assert on the local cache
// writes made for a remote-pointer block directly.
const { localCacheSetItem } = vi.hoisted(() => ({
    localCacheSetItem: vi.fn(async (_key: string, _value: unknown) => {}),
}))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: localCacheSetItem,
            removeItem: vi.fn(async () => {}),
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
            // AV-3: getFileSrcCached calls this predicate.
            isPlainHttpFileSrc: vi.fn(() => false),
        }) as unknown as typeof import('src/ts/globalApi.svelte'),
)

// The encoder and decoder reach the remote blocks through the page's byte
// store; this suite's in-memory model of them is the mocked `forageStorage`
// above, so the store is a thin view over it and every call is still counted
// on its spies.
vi.mock(import('src/ts/storage/store/appStore'), async () => {
    const { appStoreModuleOver } = await import('src/ts/storage/tests/appStoreMock')
    const { forageStorage } = await import('src/ts/globalApi.svelte')
    return appStoreModuleOver(() => forageStorage as unknown as ForageLike) as unknown as typeof import('src/ts/storage/store/appStore')
})

vi.mock(
    import('src/ts/storage/database.svelte'),
    () =>
        ({
            getDatabase: vi.fn(() => ({ enableRemoteSaving: true })),
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

import { RisuSaveEncoder, decodeRisuSave } from '../risuSave'
import type { toSaveType } from '../risuSave'
import type { Database } from '../database.svelte'
import { forageStorage } from 'src/ts/globalApi.svelte'

// CHORE-17: reset the shared mocks before every test so a
// call count asserted in one test never includes a call made by another.
// `remoteStore.clear()` is also done per-test by the suite below; also done
// here so newly added tests get it too without repeating it.
beforeEach(() => {
    remoteStore.clear()
    ;(forageStorage.setItem as ReturnType<typeof vi.fn>).mockClear()
    ;(forageStorage.getItem as ReturnType<typeof vi.fn>).mockClear()
    ;(forageStorage.keys as ReturnType<typeof vi.fn>).mockClear()
    localCacheSetItem.mockClear()
})

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

function buildFixtureDb(chaData: string): Database {
    return {
        formatversion: 5,
        botPresets: [],
        botPresetsId: 0,
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characters: [
            {
                chaId: 'char-remote-1',
                type: 'character',
                name: 'Test Character',
                data: chaData,
                chats: [],
            },
        ],
    } as unknown as Database
}

async function encodeFixture(chaData: string): Promise<Uint8Array> {
    const encoder = new RisuSaveEncoder()
    await encoder.init(buildFixtureDb(chaData), { skipRemoteSavingOnCharacters: false })
    const encoded = encoder.encode()
    expect(encoded).not.toBeNull()
    return new Uint8Array(encoded!)
}

// Note: this covers only the content-addressed naming/encode/decode
// mechanism. Automatic reclamation of superseded remote blocks is out of
// scope: superseded remote blocks are left unmanaged by the existing
// (unmodified, pre-existing) cleanChunks() GC path, which only ever
// recognizes the legacy bare-name (`.local.bin`) shape.
describe('Remote block content-addressed naming', () => {
    test('publishes a v2 pointer whose hash resolves to a real remotes/ key', async () => {
        remoteStore.clear()
        await encodeFixture('hello world')
        const remoteKeys = Array.from(remoteStore.keys())
        expect(remoteKeys.length).toBe(1)
        expect(remoteKeys[0]).toMatch(/^remotes\/char-remote-1\.[0-9a-f]{16}\.bin$/)
    })

    test('round-trips through decode — the character is recovered via its remote block', async () => {
        remoteStore.clear()
        const encoded = await encodeFixture('round trip payload')
        const decoded = await decodeRisuSave(encoded)
        const cha = decoded.characters?.find((c: any) => c.chaId === 'char-remote-1') as any
        expect(cha?.data).toBe('round trip payload')
    })

    test('identical content re-encodes to the same key (dedup, idempotent no-op)', async () => {
        remoteStore.clear()
        await encodeFixture('same content')
        expect(remoteStore.size).toBe(1)
        const firstKey = Array.from(remoteStore.keys())[0]
        await encodeFixture('same content')
        expect(remoteStore.size).toBe(1)
        expect(Array.from(remoteStore.keys())[0]).toBe(firstKey)
    })

    test('different content produces a different key (no silent overwrite of a superseded version)', async () => {
        remoteStore.clear()
        await encodeFixture('content A')
        const keyA = Array.from(remoteStore.keys())[0]
        await encodeFixture('content B')
        const keys = Array.from(remoteStore.keys())
        // Both versions still present in storage — reclaiming the superseded
        // one is explicitly out of scope for this change; see the note above.
        expect(keys).toContain(keyA)
        expect(keys.length).toBe(2)
    })
})

// CHORE-17. A remote file is
// not rewritten once this page load has written it or confirmed it exists,
// tracked by the module-level `checkedRemoteExistence`, which records a name
// only once its write resolves or its existence check confirms the file --
// never before. A8 and B1 pin the skip itself. B4c
// additionally pins that the local pointer block's own comparison runs
// through the word loop and not just the tail, by choosing a chaId whose
// pointer block length lands on a multiple of 4 (see B4c's own comment for
// why an unescaped chaId can't). B2, B3 and B7 pin retry and recording
// behaviour around a throwing write and a confirmed-existing file. B4 and
// B4b pin that a changed character still writes a new hash file. (B3 and B7
// each isolate their own module instance via
// `vi.resetModules()`, since they manipulate `skipRemoteSavingOnCharacters:
// true` and the existence-check recording path the other tests below don't
// otherwise touch.)
describe('RisuSaveEncoder — CHORE-17, the remote file skip and existence-check recording', () => {
    function forageSetItemCallsForKey(key: string): number {
        return (forageStorage.setItem as ReturnType<typeof vi.fn>).mock.calls.filter(
            (args) => args[0] === key,
        ).length
    }

    test('A8 (red): an unchanged, marked character\'s remote pointer is not rewritten in the local cache the second time set() runs', async () => {
        const db = buildFixtureDb('A8 unchanged content')
        const encoder = new RisuSaveEncoder()
        await encoder.init(db, { skipRemoteSavingOnCharacters: false })

        await encoder.set(db, makeToSave(['char-remote-1']))
        const countAfterFirstSet = localCacheSetItem.mock.calls.filter(
            (args) => args[0] === 'risuSaveBlock_char-remote-1',
        ).length

        await encoder.set(db, makeToSave(['char-remote-1']))
        const countAfterSecondSet = localCacheSetItem.mock.calls.filter(
            (args) => args[0] === 'risuSaveBlock_char-remote-1',
        ).length

        expect(countAfterSecondSet).toBe(countAfterFirstSet)
        expect(countAfterSecondSet).toBe(0)
    })

    test('B1 (red): an unchanged character across two set() calls does not rewrite its content-addressed remote file', async () => {
        const db = buildFixtureDb('B1 unchanged content')
        const encoder = new RisuSaveEncoder()
        await encoder.init(db, { skipRemoteSavingOnCharacters: false })
        const remoteKey = Array.from(remoteStore.keys())[0]

        await encoder.set(db, makeToSave(['char-remote-1']))
        const countAfterFirstSet = forageSetItemCallsForKey(remoteKey)

        await encoder.set(db, makeToSave(['char-remote-1']))
        const countAfterSecondSet = forageSetItemCallsForKey(remoteKey)

        expect(countAfterSecondSet).toBe(countAfterFirstSet)
    })

    test('B2 (guard): a remote write that throws is retried by the next save (skipRemoteSaving false, so nothing gates a retry)', async () => {
        const db = buildFixtureDb('B2 content')
        const encoder = new RisuSaveEncoder()
        ;(forageStorage.setItem as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
            throw new Error('write failed')
        })

        await expect(encoder.init(db, { skipRemoteSavingOnCharacters: false })).rejects.toThrow('write failed')
        expect(remoteStore.size).toBe(0)

        await encoder.init(db, { skipRemoteSavingOnCharacters: false })
        expect(remoteStore.size).toBe(1)
    })

    test('B3 (red, fact 8): a throwing remote write is retried by the next init(), because the name is recorded only after the write resolves', async () => {
        // Isolated module instance (fresh `checkedRemoteExistence`) so this
        // test's use of `skipRemoteSavingOnCharacters: true` cannot leak into,
        // or be polluted by, any other test in this file.
        vi.resetModules()
        const { forageStorage: freshForageStorage } = await import('src/ts/globalApi.svelte')
        const { RisuSaveEncoder: FreshRisuSaveEncoder } = await import('../risuSave')

        ;(freshForageStorage.setItem as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
            throw new Error('write failed')
        })

        const db = buildFixtureDb('B3 content')
        const encoder = new FreshRisuSaveEncoder()
        // remoteStore is empty (cleared in beforeEach), so the existence check
        // this first call performs (skipRemoteSavingOnCharacters: true) reports
        // "missing", `arg.skipRemoteSaving` is turned off, and the write is
        // attempted -- and throws.
        await expect(
            encoder.init(db, { skipRemoteSavingOnCharacters: true }),
        ).rejects.toThrow('write failed')

        // Second attempt, same instance, same content: the first attempt's
        // write threw before the name was recorded (fact 8's fix records a
        // name only once its write resolves, never before), so this retry
        // still finds the name unrecorded and writes the file.
        await encoder.init(db, { skipRemoteSavingOnCharacters: true })
        expect(remoteStore.size).toBe(1)
    })

    test('B4 (guard): a changed character writes a new hash file, and decode reads the new content', async () => {
        const db = buildFixtureDb('B4 content A')
        const encoder = new RisuSaveEncoder()
        await encoder.init(db, { skipRemoteSavingOnCharacters: false })
        const keyAfterInit = Array.from(remoteStore.keys())[0]

        // `data` isn't a real `character` field -- it's the fixture's
        // arbitrary content-differentiator (see buildFixtureDb), cast here
        // just to satisfy the type checker for that synthetic field.
        ;(db.characters[0] as any).data = 'B4 content B'
        await encoder.set(db, makeToSave(['char-remote-1']))

        const keys = Array.from(remoteStore.keys())
        expect(keys).toContain(keyAfterInit)
        expect(keys.length).toBe(2)

        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))
        const cha = decoded.characters?.find((c: any) => c.chaId === 'char-remote-1') as any
        expect(cha?.data).toBe('B4 content B')
    })

    test('B4b (guard, equal length): a content change that keeps the same byte length still writes a new hash file and changes the pointer block in the layout', async () => {
        const db = buildFixtureDb('B4b content one')
        const encoder = new RisuSaveEncoder()
        await encoder.init(db, { skipRemoteSavingOnCharacters: false })
        const keyAfterInit = Array.from(remoteStore.keys())[0]
        const layoutBefore = encoder.snapshotLayout()!
        encoder.markLayoutCommitted(layoutBefore)

        // Same length as 'B4b content one' -- pins that neither the remote
        // hash-file write nor the comparison of the local pointer block is
        // fooled by a content change that happens to keep the same byte
        // length. The pointer JSON in particular (`{v,type,name,hash}`) is
        // the same length on every write regardless of what changed, since
        // the hash is always a fixed-length hex string -- a length-only
        // comparator would always wrongly treat the pointer as unchanged.
        ;(db.characters[0] as any).data = 'B4b content two'
        await encoder.set(db, makeToSave(['char-remote-1']))

        const keys = Array.from(remoteStore.keys())
        expect(keys).toContain(keyAfterInit)
        expect(keys.length).toBe(2)

        const layoutAfter = encoder.snapshotLayout()!
        expect(layoutAfter.blocks[layoutAfter.keys.indexOf('char-remote-1')])
            .not.toEqual(layoutBefore.blocks[layoutBefore.keys.indexOf('char-remote-1')])
        expect(encoder.layoutEqualsCommitted(layoutAfter)).toBe(false)

        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))
        const cha = decoded.characters?.find((c: any) => c.chaId === 'char-remote-1') as any
        expect(cha?.data).toBe('B4b content two')
    })

    /**
     * Mirrors encodeRawBlock's own framing math for a v2 remote pointer's
     * block (a fixed-shape `{v,type,name,hash}` JSON, `hash` always 16 hex
     * chars), so the fixture below can assert its own block length instead
     * of hard-coding a number that would go stale silently if that framing
     * ever changed.
     */
    function pointerBlockLength(chaId: string, type: number): number {
        const nameBufLen = new TextEncoder().encode(chaId).length
        const content = JSON.stringify({ v: 2, type, name: chaId, hash: '0'.repeat(16) })
        const databufLen = new TextEncoder().encode(content).length
        return (2 + 1 + nameBufLen + 4) + 4 + databufLen + 4
    }

    test('B4c (guard, word-aligned): a changed character still changes the pointer block in the layout when the pointer block length is a multiple of 4', async () => {
        // Guards specifically against the word check: without a multiple-of-4
        // block length, a trailing byte the tail loop checks on its own could
        // happen to be a CRC32 checksum byte that differs whenever the
        // content does. A v2 pointer's JSON (`{"v":2,"type":<digit>,"name":"...",
        // "hash":"<16 hex chars>"}`) is otherwise always an odd number of
        // bytes for any *unescaped* chaId -- growing the name by one byte
        // grows the JSON by exactly two (once in "name", once implicitly
        // via the fixed hash length), which can never change that parity.
        // A backslash in the chaId breaks that: it costs the JSON one extra
        // escape byte (`\\`) that the raw framing `name` field (nameBufLen)
        // doesn't pay, which is what lets this specific pointer land on a
        // multiple of 4 -- leaving zero trailing bytes, so nothing but the
        // word loop is left to catch the hash difference below.
        const chaId = 'r\\xxxx'
        const CHARACTER_WITH_CHAT = 2 // RisuSaveType.CHARACTER_WITH_CHAT (not exported; mirrored here for the length check only)
        expect(pointerBlockLength(chaId, CHARACTER_WITH_CHAT) % 4).toBe(0)

        const db: Database = {
            formatversion: 5,
            botPresets: [],
            botPresetsId: 0,
            modules: [],
            loadouts: [],
            plugins: [],
            pluginCustomStorage: {},
            characters: [
                { chaId, type: 'character', name: 'Test Character', data: 'B4c content one', chats: [] },
            ],
        } as unknown as Database
        const encoder = new RisuSaveEncoder()
        await encoder.init(db, { skipRemoteSavingOnCharacters: false })
        const layoutBefore = encoder.snapshotLayout()!
        encoder.markLayoutCommitted(layoutBefore)

        ;(db.characters[0] as any).data = 'B4c content two'
        await encoder.set(db, makeToSave([chaId]))

        const layoutAfter = encoder.snapshotLayout()!
        const pointerBefore = layoutBefore.blocks[layoutBefore.keys.indexOf(chaId)]
        const pointerAfter = layoutAfter.blocks[layoutAfter.keys.indexOf(chaId)]
        expect(pointerAfter.length).toBe(pointerBefore.length)
        expect(pointerAfter).not.toEqual(pointerBefore)
        expect(encoder.layoutEqualsCommitted(layoutAfter)).toBe(false)
    })

    test('B7 (guard): a boot init() whose existence check confirms the file records it, and an unchanged set() then does not rewrite', async () => {
        // Isolated module instance (fresh `checkedRemoteExistence`), like
        // B3, since this drives the boot default (`skipRemoteSavingOnCharacters`
        // defaults to true) and its existence-check recording path.
        vi.resetModules()
        const { forageStorage: freshForageStorage } = await import('src/ts/globalApi.svelte')
        const { RisuSaveEncoder: FreshRisuSaveEncoder } = await import('../risuSave')

        const chaId = 'char-remote-confirmed-existing'
        const character = { chaId, type: 'character', name: 'Test Character', data: 'B7 content', chats: [] }
        const db: Database = {
            formatversion: 5,
            botPresets: [],
            botPresetsId: 0,
            modules: [],
            loadouts: [],
            plugins: [],
            pluginCustomStorage: {},
            characters: [character],
        } as unknown as Database

        // The exact content-addressed name this character will hash to,
        // computed the same way hashRemoteBlockContent does, so the file can
        // be seeded as "already there" (e.g. from a previous page load)
        // before init() ever runs.
        const encoded = new TextEncoder().encode(JSON.stringify(character))
        const digest = await crypto.subtle.digest('SHA-256', encoded)
        const hash = Array.from(new Uint8Array(digest))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('')
            .slice(0, 16)
        const fileName = `remotes/${chaId}.${hash}.bin`
        remoteStore.set(fileName, new Uint8Array([1]))

        const encoder = new FreshRisuSaveEncoder()
        await encoder.init(db) // skipRemoteSavingOnCharacters defaults to true

        const writesForFile = () =>
            (freshForageStorage.setItem as ReturnType<typeof vi.fn>).mock.calls.filter(
                (args) => args[0] === fileName,
            ).length
        expect(writesForFile()).toBe(0) // confirmed existing during init()'s existence check, never (re)written

        await encoder.set(db, makeToSave([chaId]))
        expect(writesForFile()).toBe(0) // still not written -- init() already recorded it as confirmed
    })
})
