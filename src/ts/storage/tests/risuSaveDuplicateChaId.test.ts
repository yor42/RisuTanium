import { describe, test, expect, vi, beforeEach } from 'vitest'
import type { ForageLike } from './forageBackedStore'

//#region module mocks -- copied from risuSave.test.ts (see that file's header
// for the full rationale; not repeated here).

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

import { RisuSaveEncoder, decodeRisuSave } from '../risuSave'
import type { toSaveType } from '../risuSave'
import type { Database } from '../database.svelte'

beforeEach(() => {
    store.clear()
    cacheSetItem.mockClear()
    cacheGetItem.mockClear()
    cacheRemoveItem.mockClear()
})

type CharacterFixture = Database['characters'][number]

function makeCharacter(chaId: string, name: string): CharacterFixture {
    return {
        chaId,
        type: 'character',
        name,
        chats: [],
    } as unknown as CharacterFixture
}

function makeGroup(chaId: string, name: string): CharacterFixture {
    return {
        chaId,
        type: 'group',
        name,
        characters: [],
        chats: [],
    } as unknown as CharacterFixture
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

function buildDb(characters: CharacterFixture[]): Database {
    return {
        formatversion: 5,
        botPresets: [],
        botPresetsId: 0,
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characters,
    } as unknown as Database
}

async function decodeCharacter(encoder: RisuSaveEncoder, chaId: string): Promise<CharacterFixture | undefined> {
    const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))
    return decoded.characters?.find((c: CharacterFixture) => c.chaId === chaId)
}

// MC-078, MC-079, MC-082. Once a key has a saved block, both `set()` and
// `init()` keep it unchanged regardless of list order or which holder is
// marked. While a key has never been saved (MC-082), both `set()` and
// `init()` write the first holder in snapshot order once, then freeze the
// same way. The scenarios below list the copy ahead of the already-saved
// original (`[copy, original]`) because that is the order that makes each
// one fail against a `set()` that simply overwrites the block from whichever
// holder its linear scan reaches while a mark is still present -- not
// because the fixed outcome itself depends on the order.
describe('RisuSaveEncoder.set() -- a chaId held by two characters keeps its already-saved block', () => {
    test('a marked set() pass over [copy, original] does not overwrite the block with the unmarked copy', async () => {
        const chaId = 'dup-1'
        const original = makeCharacter(chaId, 'Original')
        const encoder = new RisuSaveEncoder()
        await encoder.init(buildDb([original]))

        const copy = makeCharacter(chaId, 'Copy')
        const db = buildDb([copy, original])
        await encoder.set(db, makeToSave([chaId]))

        const decodedChar = await decodeCharacter(encoder, chaId)
        expect(decodedChar?.name).toBe('Original')
    })
})

describe('RisuSaveEncoder.set() -- an edit to the marked holder of a duplicated key does not reach the block', () => {
    test('a marked set() pass over [copy, edited original] keeps the block at its last-saved content', async () => {
        const chaId = 'dup-2'
        const original = makeCharacter(chaId, 'Original')
        const encoder = new RisuSaveEncoder()
        await encoder.init(buildDb([original]))

        const copy = makeCharacter(chaId, 'Copy')
        const editedOriginal = makeCharacter(chaId, 'Original (edited)')
        const db = buildDb([copy, editedOriginal])
        await encoder.set(db, makeToSave([chaId]))

        const decodedChar = await decodeCharacter(encoder, chaId)
        expect(decodedChar?.name).toBe('Original')
    })
})

// A frozen key is taken out of toSave.character before set()'s deletion
// branch runs, so it is never treated as "probably deleted" merely because
// its mark could not be applied to either holder (MC-078, MC-079, MC-082).
describe('RisuSaveEncoder.set() -- a duplicated key is never treated as deleted', () => {
    test('a marked set() pass over a duplicated key does not delete its block or log it as deleted', async () => {
        const chaId = 'dup-3'
        const original = makeCharacter(chaId, 'Original')
        const encoder = new RisuSaveEncoder()
        await encoder.init(buildDb([original]))

        const copy = makeCharacter(chaId, 'Copy')
        const db = buildDb([copy, original])
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
        try {
            await encoder.set(db, makeToSave([chaId]))

            const decodedChar = await decodeCharacter(encoder, chaId)
            expect(decodedChar).toBeDefined()

            const deletingLog = logSpy.mock.calls.some((args) =>
                args.some((a) => typeof a === 'string' && a.includes('Deleting character data') && a.includes(chaId)))
            expect(deletingLog).toBe(false)
        } finally {
            logSpy.mockRestore()
        }
    })

    // Every occurrence of a frozen key is removed from toSave.character, not
    // only the first -- a dirty-marking effect can add the same id twice in
    // one pass. With only the first occurrence removed, the leftover second
    // occurrence still triggers the "Deleting character data" log after the
    // loop (the block itself survives regardless, since savedId already
    // protects it), which is a stale, misleading log line for a block that
    // was actually kept.
    test('a duplicated key marked twice in one pass keeps its block and is not logged as deleted', async () => {
        const chaId = 'k2'
        const otherId = 'x'
        const original = makeCharacter(chaId, 'Original')
        const encoder = new RisuSaveEncoder()
        await encoder.init(buildDb([original]))

        const copy = makeCharacter(chaId, 'Copy')
        const other = makeCharacter(otherId, 'Other')
        const db = buildDb([copy, original, other])
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
        try {
            await encoder.set(db, makeToSave([chaId, otherId, chaId]))

            const decodedChar = await decodeCharacter(encoder, chaId)
            expect(decodedChar?.name).toBe('Original')

            const deletingLog = logSpy.mock.calls.some((args) =>
                args.some((a) => typeof a === 'string' && a.includes('Deleting character data') && a.includes(chaId)))
            expect(deletingLog).toBe(false)
        } finally {
            logSpy.mockRestore()
        }
    })

    // The deletion loop matches by savedId.has(String(chaId)), not identity --
    // a dirty-marking effect can leave a raw, non-string chaId as a leftover
    // mark (frontUnshiftSelected pushes the raw value, and only the first
    // occurrence of a repeated mark is spliced by the single-holder branch
    // above). This is the exact shape produced by selecting character 5,
    // selecting another character, then reselecting and editing 5: marks end
    // up as [5, 'x', 5], where 'x' is a stale id absent from the list.
    test('a numeric chaId marked twice around an absent id keeps its edited block and is not deleted', async () => {
        const original = { chaId: 5, type: 'character', name: 'Original', chats: [] } as unknown as CharacterFixture
        const encoder = new RisuSaveEncoder()
        await encoder.init(buildDb([original]))

        const edited = { chaId: 5, type: 'character', name: 'Edited', chats: [] } as unknown as CharacterFixture
        const toSave = makeToSave([])
        toSave.character = [5, 'x', 5] as unknown as string[]
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
        try {
            await encoder.set(buildDb([edited]), toSave)

            const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))
            const decodedChar = decoded.characters?.find((c: CharacterFixture) => String(c.chaId) === '5')
            expect(decodedChar?.name).toBe('Edited')
        } finally {
            logSpy.mockRestore()
        }
    })
})

// The encoder's holder count keys on String(chaId), the same coercion a
// plain object's own property access already applies to this.blocks[chaId]
// -- so a numeric chaId and its string form name the same block and count as
// one duplicated key, not two independent ones.
describe('RisuSaveEncoder -- a numeric chaId and its string form count as one duplicated key', () => {
    test('holders 123 and "123" are treated as a single duplicated key, and the existing block is kept', async () => {
        const numericHolder = { chaId: 123, type: 'character', name: 'Numeric', chats: [] } as unknown as CharacterFixture
        const encoder = new RisuSaveEncoder()
        await encoder.init(buildDb([numericHolder]))

        const stringHolder = makeCharacter('123', 'StringForm')
        const db = buildDb([stringHolder, numericHolder])
        await encoder.set(db, makeToSave(['123']))

        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))
        const matches = decoded.characters?.filter((c: CharacterFixture) => String(c.chaId) === '123')
        expect(matches?.length).toBe(1)
        expect(matches?.[0].name).toBe('Numeric')
        expect(encoder.getFrozenKeys().has('123')).toBe(true)
    })
})

// toSave.character marks are matched by String(mark) === key, not identity,
// since a dirty-marking effect can push a character's raw, possibly
// non-string chaId into it -- a raw numeric mark must still find, and clear,
// its own holder's string-keyed block.
describe('RisuSaveEncoder.set() -- a raw numeric mark matches its holder\'s string-keyed block', () => {
    test('a single holder with a numeric chaId is written and its raw numeric mark is cleared', async () => {
        const numericHolder = { chaId: 5, type: 'character', name: 'Original', chats: [] } as unknown as CharacterFixture
        const encoder = new RisuSaveEncoder()
        await encoder.init(buildDb([numericHolder]))

        const edited = { chaId: 5, type: 'character', name: 'Edited', chats: [] } as unknown as CharacterFixture
        const toSave = makeToSave([])
        // The raw, uncoerced mark -- not the string form -- exactly like a
        // dirty-marking effect would push it.
        toSave.character = [5 as unknown as string]
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
        try {
            await encoder.set(buildDb([edited]), toSave)

            const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))
            const decodedChar = decoded.characters?.find((c: CharacterFixture) => String(c.chaId) === '5')
            expect(decodedChar?.name).toBe('Edited')

            const deletingLog = logSpy.mock.calls.some((args) =>
                args.some((a) => typeof a === 'string' && a.includes('Deleting character data')))
            expect(deletingLog).toBe(false)
        } finally {
            logSpy.mockRestore()
        }
    })

    // removeAllOccurrences compares by String(list[i]), not identity -- with
    // only an identity comparison, a raw numeric mark stays in
    // toSave.character even after this key's block is kept, which leaves a
    // stale entry there. That stale entry does not lose the block (the
    // deletion loop's own savedId check still coerces), but it does leave a
    // spurious "Deleting character data" log line and a non-empty
    // toSave.character after the pass -- checked here directly, not just the
    // survival of the block.
    test('two holders with a numeric chaId and a raw numeric mark keep the existing block', async () => {
        const holder1 = { chaId: 123, type: 'character', name: 'Holder1', chats: [] } as unknown as CharacterFixture
        const encoder = new RisuSaveEncoder()
        await encoder.init(buildDb([holder1]))

        const holder2 = { chaId: 123, type: 'character', name: 'Holder2', chats: [] } as unknown as CharacterFixture
        const toSave = makeToSave([])
        toSave.character = [123 as unknown as string]
        await encoder.set(buildDb([holder2, holder1]), toSave)

        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))
        const decodedChar = decoded.characters?.find((c: CharacterFixture) => String(c.chaId) === '123')
        expect(decodedChar?.name).toBe('Holder1')
        expect(toSave.character.length).toBe(0)
        expect(encoder.getFrozenKeys().has('123')).toBe(true)
    })
})

describe('RisuSaveEncoder.set() -- saving resumes once a duplicate resolves, with the surviving holder\'s current content', () => {
    test('once the copy is removed with no further mark, the next set() writes the survivor\'s edited content', async () => {
        const chaId = 'dup-4'
        const original = makeCharacter(chaId, 'Original')
        const encoder = new RisuSaveEncoder()
        await encoder.init(buildDb([original]))

        // The copy is inserted ahead of the original, and the original is
        // edited and marked while the key is duplicated -- this pass alone
        // does not resolve the duplicate.
        const copy = makeCharacter(chaId, 'Copy')
        const editedOriginal = makeCharacter(chaId, 'Original (edited)')
        await encoder.set(buildDb([copy, editedOriginal]), makeToSave([chaId]))

        // The copy is removed from the list with no mark set afterward --
        // e.g. a permanent delete of the trashed copy, which sets no save
        // mark of its own.
        const db = buildDb([editedOriginal])
        await encoder.set(db, makeToSave([]))

        const decodedChar = await decodeCharacter(encoder, chaId)
        expect(decodedChar?.name).toBe('Original (edited)')
    })
})

describe('RisuSaveEncoder.set() -- a key that resolved once stays at its resolved content through a later, separate duplicate', () => {
    test('a fresh copy inserted after resolution does not move the block off the resolved content', async () => {
        const chaId = 'dup-5'
        const original = makeCharacter(chaId, 'Original')
        const encoder = new RisuSaveEncoder()
        await encoder.init(buildDb([original]))

        // The key resolves once, at 'Original (edited)'.
        const copy = makeCharacter(chaId, 'Copy')
        const editedOriginal = makeCharacter(chaId, 'Original (edited)')
        await encoder.set(buildDb([copy, editedOriginal]), makeToSave([chaId]))
        await encoder.set(buildDb([editedOriginal]), makeToSave([]))
        expect((await decodeCharacter(encoder, chaId))?.name).toBe('Original (edited)')

        // A new copy is inserted ahead of the resolved holder, and its key is
        // marked again.
        const copyC = makeCharacter(chaId, 'Copy C')
        await encoder.set(buildDb([copyC, editedOriginal]), makeToSave([chaId]))

        const decodedChar = await decodeCharacter(encoder, chaId)
        expect(decodedChar?.name).toBe('Original (edited)')
    })
})

// Coverage: two characters with different chaIds, both marked (one
// redundantly), are both written -- neither deleted. See
// src/ts/storage/tests/risuSave.test.ts, "marking BOTH ids (one redundantly)
// re-encodes both; neither is deleted".

describe('RisuSaveEncoder.init() -- a copy pushed onto the live array partway through a pass must not win the block', () => {
    test('a copy appended to data.characters right after the original\'s block write resolves does not overwrite it', async () => {
        const chaId = 'dup-7'
        const original = makeCharacter(chaId, 'Original')
        const characters = [original]
        const db = buildDb(characters)
        let copyAppended = false

        // `init()`'s only await between one character's block write completing
        // and the next character being read is the cache `setItem()` call
        // inside `encodeRawBlock` -- this pushes the copy onto the SAME live
        // array `init()` is iterating, right after the original's write has
        // already resolved, without adding any hook to non-test source.
        cacheSetItem.mockImplementation(async (key: string, value: unknown) => {
            store.set(key, value)
            if (key === `risuSaveBlock_${chaId}` && !copyAppended) {
                copyAppended = true
                characters.push(makeCharacter(chaId, 'Copy'))
            }
        })

        const encoder = new RisuSaveEncoder()
        await encoder.init(db)

        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))
        const decodedChar = decoded.characters?.find((c: CharacterFixture) => c.chaId === chaId)
        expect(decodedChar?.name).toBe('Original')
        // One block under this chaId, not two -- the copy's own write never
        // happened this pass, so it never produced a second entry either.
        expect(decoded.characters?.length).toBe(1)

        // Once the duplicate is visible, a further marked set() with the
        // copy edited must not disturb the kept block either.
        const editedCopy = characters[1]
        editedCopy.name = 'Copy (edited)'
        await encoder.set(buildDb(characters), makeToSave([chaId]))

        const decodedAfterSet = await decodeCharacter(encoder, chaId)
        expect(decodedAfterSet?.name).toBe('Original')
    })
})

describe('RisuSaveEncoder.set() -- a copy inserted onto the live array partway through a pass must not be encoded that same pass', () => {
    test('a copy pushed onto the live array right after the edited original\'s write resolves is not encoded until the next pass', async () => {
        const chaId = 'dup-7-set'
        const original = makeCharacter(chaId, 'Original')
        const encoder = new RisuSaveEncoder()
        await encoder.init(buildDb([original]))

        const editedOriginal = makeCharacter(chaId, 'Original (edited)')
        const characters = [editedOriginal]
        let copyInserted = false

        // set()'s only await between the edited original's block write
        // resolving and the pass ending is the same cache setItem() call,
        // this time triggered by content that genuinely differs from the
        // last-cached bytes (an unchanged write is skipped without an await
        // at all -- see encodeRawBlock's rawBlockBytesEqual short-circuit).
        cacheSetItem.mockImplementation(async (key: string, value: unknown) => {
            store.set(key, value)
            if (key === `risuSaveBlock_${chaId}` && !copyInserted) {
                copyInserted = true
                characters.push(makeCharacter(chaId, 'Copy'))
            }
        })

        await encoder.set(buildDb(characters), makeToSave([chaId]))

        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))
        const decodedChar = decoded.characters?.find((c: CharacterFixture) => c.chaId === chaId)
        expect(decodedChar?.name).toBe('Original (edited)')
        expect(decoded.characters?.length).toBe(1)

        // The pushed copy is only visible starting with the NEXT pass.
        expect(characters.length).toBe(2)
    })
})

// The per-pass copy of the character list (data.characters.slice()) is what
// keeps a splice on the live array, made from another holder's own await,
// from corrupting an unrelated third holder's write -- this holds even
// without any chaId duplication at all.
describe('RisuSaveEncoder.set() -- a character spliced from the live array during another holder\'s own write must not corrupt a third, unrelated holder', () => {
    test('Z removed from the live array during its own write does not skip A, and does not leak C\'s content under A\'s key', async () => {
        const zId = 'mid-z'
        const aId = 'mid-a'
        const cId = 'mid-c'
        const z = makeCharacter(zId, 'Z')
        const a = makeCharacter(aId, 'A')
        const c = makeCharacter(cId, 'C')
        const characters = [z, a, c]
        const encoder = new RisuSaveEncoder()
        await encoder.init(buildDb([]))
        let zRemoved = false

        // set()'s only await between one holder's block write completing and
        // the next holder being read is the cache setItem() call inside
        // encodeRawBlock -- this splices Z out of the SAME live array set()
        // is iterating, during Z's own write, without adding any hook to
        // non-test source.
        cacheSetItem.mockImplementation(async (key: string, value: unknown) => {
            store.set(key, value)
            if (key === `risuSaveBlock_${zId}` && !zRemoved) {
                zRemoved = true
                const idx = characters.indexOf(z)
                if (idx !== -1) {
                    characters.splice(idx, 1)
                }
            }
        })

        await encoder.set(buildDb(characters), makeToSave([zId, aId, cId]))

        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))
        const decodedA = decoded.characters?.find((ch: CharacterFixture) => ch.chaId === aId)
        const decodedC = decoded.characters?.find((ch: CharacterFixture) => ch.chaId === cId)

        // A is saved with its own content and is not deleted.
        expect(decodedA?.name).toBe('A')
        // C's content lands under C's own identity, not consumed into a slot
        // a live-array read would have shifted into A's cached key.
        expect(decodedC?.name).toBe('C')
        // All three holders present -- nothing lost, nothing merged.
        expect(decoded.characters?.length).toBe(3)
    })
})

// Each holder's chaId is read once, at the start of the pass, into a value
// that is never re-read from the character later -- so a chaId edited
// in-place mid-pass (not spliced, not replaced, the same object mutated,
// before that holder's own turn in the loop) still encodes and freezes under
// the value it held when the pass started, and still counts toward the
// duplicate it started the pass as part of.
describe('RisuSaveEncoder.set() -- a chaId edited mid-pass still encodes and freezes under the key it held when the pass started', () => {
    test('holder1\'s block is written under its starting, duplicated chaId, even though its chaId changed before its own turn in the loop', async () => {
        const dupId = 'mid-edit-dup'
        const otherId = 'mid-edit-other'
        const changedId = 'mid-edit-changed'
        const other = makeCharacter(otherId, 'Other')
        const holder1 = makeCharacter(dupId, 'Holder1')
        const holder2 = makeCharacter(dupId, 'Holder2')
        // `other` is processed first, so its own write's await is where the
        // mutation below happens -- BEFORE holder1's own turn in the loop,
        // not during it.
        const characters = [other, holder1, holder2]
        const encoder = new RisuSaveEncoder()
        await encoder.init(buildDb([]))
        let idChanged = false

        cacheSetItem.mockImplementation(async (key: string, value: unknown) => {
            store.set(key, value)
            if (key === `risuSaveBlock_${otherId}` && !idChanged) {
                idChanged = true
                ;(holder1 as unknown as { chaId: string }).chaId = changedId
            }
        })

        await encoder.set(buildDb(characters), makeToSave([otherId, dupId]))

        // holder1's own serialized content now carries its CURRENT chaId
        // (nothing rewrites a character's own field), so identity here is
        // checked by name, not by the decoded chaId field.
        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))
        const decodedNames = new Set(decoded.characters?.map((ch: CharacterFixture) => ch.name))

        // holder1 -- first in snapshot order -- is the one frozen for the
        // starting duplicate; holder2 is skipped entirely by the per-pass
        // dedupe and never gets a block of its own.
        expect(decodedNames.has('Holder1')).toBe(true)
        expect(decodedNames.has('Holder2')).toBe(false)
        // Exactly two blocks: other, and the one holder written for the
        // starting duplicate -- nothing extra was created under a key read
        // live mid-pass.
        expect(decoded.characters?.length).toBe(2)
        expect(encoder.getFrozenKeys().has(dupId)).toBe(true)
        expect(encoder.getFrozenKeys().has(changedId)).toBe(false)
    })
})

// Each holder's chaId is read once, at the start of the pass, into a value
// that is never re-read from the character later -- the same invariant as
// set() above, for init().
describe('RisuSaveEncoder.init() -- a chaId renamed mid-pass still encodes and freezes under the key it held when the pass started', () => {
    test('holder1\'s block is written under its starting, duplicated chaId, even though its chaId changed before its own turn in the loop', async () => {
        const dupId = 'init-mid-edit-dup'
        const otherId = 'init-mid-edit-other'
        const changedId = 'init-mid-edit-changed'
        const other = makeCharacter(otherId, 'Other')
        const holder1 = makeCharacter(dupId, 'Holder1')
        const holder2 = makeCharacter(dupId, 'Holder2')
        // `other` is processed first, so its own write's await is where the
        // mutation below happens -- BEFORE holder1's own turn in the loop,
        // not during it.
        const characters = [other, holder1, holder2]
        const encoder = new RisuSaveEncoder()
        let idChanged = false

        cacheSetItem.mockImplementation(async (key: string, value: unknown) => {
            store.set(key, value)
            if (key === `risuSaveBlock_${otherId}` && !idChanged) {
                idChanged = true
                ;(holder1 as unknown as { chaId: string }).chaId = changedId
            }
        })

        await encoder.init(buildDb(characters))

        // holder1's own serialized content now carries its CURRENT chaId
        // (nothing rewrites a character's own field), so identity here is
        // checked by name, not by the decoded chaId field.
        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))
        const decodedNames = new Set(decoded.characters?.map((ch: CharacterFixture) => ch.name))

        // holder1 -- first in snapshot order -- is the one frozen for the
        // starting duplicate; holder2 is skipped entirely by the per-pass
        // dedupe and never gets a block of its own.
        expect(decodedNames.has('Holder1')).toBe(true)
        expect(decodedNames.has('Holder2')).toBe(false)
        // Exactly two blocks: other, and the one holder written for the
        // starting duplicate -- nothing extra was created under a key read
        // live mid-pass.
        expect(decoded.characters?.length).toBe(2)
        expect(encoder.getFrozenKeys().has(dupId)).toBe(true)
        expect(encoder.getFrozenKeys().has(changedId)).toBe(false)
    })
})

// init()'s `previous` option is consulted only inside the holders > 1
// branch -- a key with exactly one holder always gets a fresh encode, never
// a block carried from `previous`, however recent that block is.
describe('RisuSaveEncoder.init() -- previous is never consulted for a key with a single holder', () => {
    test('a reload after an unmarked in-place edit to a single-holder character writes the fresh content, not the block previous already had', async () => {
        const chaId = 'single-holder-reload'
        const original = makeCharacter(chaId, 'Original')
        const encoder = new RisuSaveEncoder()
        await encoder.init(buildDb([original]))

        // Edited in place, with no mark of any kind -- this is a reload, and
        // init() never reads toSave.
        original.name = 'Edited'

        const fresh = new RisuSaveEncoder()
        await fresh.init(buildDb([original]), { previous: encoder })

        const decoded = await decodeRisuSave(new Uint8Array(fresh.encode()!))
        const decodedChar = decoded.characters?.find((c: CharacterFixture) => c.chaId === chaId)
        expect(decodedChar?.name).toBe('Edited')
    })
})

// MC-082: while a duplicated key has never been saved, the first holder in
// list order is written once, then treated like any other duplicate -- its
// block does not change again while the key stays duplicated, even if that
// first holder is the one later edited and marked.
describe('RisuSaveEncoder -- a chaId duplicated since before it was ever saved writes only its first holder', () => {
    test('set() on a fresh encoder writes only the first of two new, unmarked holders sharing a chaId', async () => {
        const chaId = 'dup-8-set'
        const first = makeCharacter(chaId, 'First')
        const second = makeCharacter(chaId, 'Second')
        const encoder = new RisuSaveEncoder()
        // Bootstraps the non-character blocks (root, config, ...) with no
        // characters at all, so this chaId truly has no prior block of its
        // own -- encode() itself refuses to run until 'config' exists.
        await encoder.init(buildDb([]))

        // The two new holders share a key with no block yet, so this runs the
        // same "holders > 1, no existing block" branch as MC-082 above -- the
        // first holder is encoded and frozen, and the second is skipped by
        // the per-pass dedupe before it is ever considered, not because its
        // own write finds a block already there.
        await encoder.set(buildDb([first, second]), makeToSave([]))

        const decodedChar = await decodeCharacter(encoder, chaId)
        expect(decodedChar?.name).toBe('First')
    })

    test('init() on a fresh encoder writes only the first of two new holders sharing a chaId, not the last', async () => {
        const chaId = 'dup-8-init'
        const first = makeCharacter(chaId, 'First')
        const second = makeCharacter(chaId, 'Second')
        const encoder = new RisuSaveEncoder()

        await encoder.init(buildDb([first, second]))

        const decodedChar = await decodeCharacter(encoder, chaId)
        expect(decodedChar?.name).toBe('First')
    })

    test('editing and marking the already-written first holder does not move the block off its first-written content', async () => {
        const chaId = 'dup-8-resume'
        const first = makeCharacter(chaId, 'First')
        const second = makeCharacter(chaId, 'Second')
        const encoder = new RisuSaveEncoder()
        await encoder.init(buildDb([]))
        await encoder.set(buildDb([first, second]), makeToSave([]))

        const editedFirst = makeCharacter(chaId, 'First (edited)')
        await encoder.set(buildDb([editedFirst, second]), makeToSave([chaId]))

        const decodedChar = await decodeCharacter(encoder, chaId)
        expect(decodedChar?.name).toBe('First')
    })
})

// The duplicate-key guard is keyed on chaId alone, so it applies identically
// whether a holder is a character or a group chat.
describe('RisuSaveEncoder -- the duplicate-key guard applies to group chats the same way it applies to characters', () => {
    test('a group chat sharing a chaId with a character keeps the already-saved block', async () => {
        const chaId = 'dup-17'
        const original = makeCharacter(chaId, 'Original Character')
        const encoder = new RisuSaveEncoder()
        await encoder.init(buildDb([original]))

        const group = makeGroup(chaId, 'Colliding Group')
        await encoder.set(buildDb([group, original]), makeToSave([chaId]))

        const decodedChar = await decodeCharacter(encoder, chaId)
        expect(decodedChar?.name).toBe('Original Character')
    })

    test('two group chats sharing a chaId keep the already-saved block', async () => {
        const chaId = 'dup-17b'
        const groupA = makeGroup(chaId, 'Group A')
        const encoder = new RisuSaveEncoder()
        await encoder.init(buildDb([groupA]))

        const groupB = makeGroup(chaId, 'Group B')
        await encoder.set(buildDb([groupB, groupA]), makeToSave([chaId]))

        const decodedChar = await decodeCharacter(encoder, chaId)
        expect(decodedChar?.name).toBe('Group A')
    })
})
