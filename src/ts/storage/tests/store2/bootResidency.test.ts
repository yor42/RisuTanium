import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock(import('src/ts/stores.svelte'), async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: {} },
        selectedCharID: writable(-1),
        selIdState: { selId: -1 },
        alertStore: writable({ type: 'none', msg: '' }),
        MobileGUI: writable(false),
        loadedStore: writable(false),
    } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))
vi.mock(import('src/ts/process/index.svelte'), async () => {
    const { writable } = await import('svelte/store')
    return { doingChat: writable(false) } as unknown as typeof import('src/ts/process/index.svelte')
})
vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn(),
    alertConfirm: vi.fn(async () => true),
}) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/storage/dbChangeEffects.svelte'), () => ({
    markIdentitySeen: vi.fn(),
}) as unknown as typeof import('src/ts/storage/dbChangeEffects.svelte'))
vi.mock(import('src/ts/characters'), () => ({
    characterFormatUpdate: vi.fn(),
}) as unknown as typeof import('src/ts/characters'))
vi.mock(import('src/ts/storage/store/appStore'), () => ({
    getAppStore: vi.fn(async () => ({
        read: async () => ({ bytes: null, version: null }),
        has: async () => false,
    })),
}) as unknown as typeof import('src/ts/storage/store/appStore'))
// The wrapped functions still run: the spies only record what the dispatch handed them, and in what order.
vi.mock(import('src/ts/storage/store2/residency'), async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, createResidency: vi.fn(actual.createResidency) }
})
vi.mock(import('src/ts/storage/store2/residencyActive'), async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, registerResidency: vi.fn(actual.registerResidency) }
})
vi.mock(import('src/ts/storage/store2/saveActive'), async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, activateStore2Save: vi.fn(actual.activateStore2Save) }
})

import { language } from 'src/lang'
import { DBState } from 'src/ts/stores.svelte'
import type { Database, character } from 'src/ts/storage/database.svelte'
import { resetPageBlockOwnerForTests } from 'src/ts/storage/pageBlockOwner'
import { resetPageStorageModeForTests } from 'src/ts/storage/pageStorageMode'
import { resetStore2BootForTest, type Store2BootResult } from 'src/ts/storage/store2/bootActive'
import { previousFrom, stubFromEntry } from 'src/ts/storage/store2/codec'
import { FRAME_HEADER_BYTES, keyOfRef, type Ref, type ShardEntry } from 'src/ts/storage/store2/format'
import { createResidency } from 'src/ts/storage/store2/residency'
import { getResidency, registerResidency, resetResidencyForTest } from 'src/ts/storage/store2/residencyActive'
import { activateStore2Save, getActiveStore2Save, resetStore2SaveForTest } from 'src/ts/storage/store2/saveActive'
import { noticeText } from 'src/ts/storage/store2/ui/bootText'
import { readColdCharacterCopy, restoreColdCharacter } from 'src/ts/process/coldCharacterRestore'
import { restoreArchivedForWrite } from 'src/ts/process/coldCharacterAccess'
import { resetRetainedForTest } from 'src/ts/process/coldRetained'
import { alertError } from 'src/ts/alert'
import { bootThroughDispatch, countedBackend, createClock, savedDatabase, seedTree, testEnv, type CountedBackend } from '../store2SaveKit'
import { buildSmall, fakeLists, type Obj } from './codecFixtures'

/**
 * The boot's residency: which characters a real store2 boot opens as stubs, what it reads to do so, and the registry the
 * rest of the page loads them through. Every case boots through the real dispatch over an in-memory backend, so a pass
 * says nothing about the real stores. Titles starting `guard:` hold before and after the change; the others fail when the
 * boot keeps every character resident (the mutant that ignores the resident planner).
 */

type Plain = Record<string, unknown>

interface Profile {
    counted: CountedBackend
    entries: ShardEntry[]
}

/** Seeds `characters` (default three) and `extra` top-level fields into a counted backend, with the reads and writes of seeding forgotten. */
async function profileOf(extra: Obj = {}, edit: (characters: Plain[]) => void = () => { }, count = 3): Promise<Profile> {
    const counted = countedBackend()
    const source = { ...(buildSmall(count) as unknown as Obj), ...extra } as unknown as Database
    edit(source.characters as unknown as Plain[])
    ;(source as unknown as Obj).characterOrder = (source.characters as unknown as Plain[]).map(slot => slot.chaId)
    const seeded = await seedTree(counted.memory, JSON.parse(JSON.stringify(source)) as Database, testEnv(createClock(), 4242), fakeLists)
    counted.reset()
    const entries = (previousFrom(seeded.tree).objects?.shards ?? []).flatMap(shard => shard.entries)
    return { counted, entries }
}

/** Every unit a character entry names. */
function unitKeysOf(entry: ShardEntry): string[] {
    const refs: (Ref | null | undefined)[] = [entry.core, entry.lore, entry.scripts, entry.al, entry.il, ...entry.chats.flatMap(chat => [chat.core, ...chat.chunks])]
    return refs.filter((ref): ref is Ref => ref !== null && ref !== undefined).map(keyOfRef)
}

function opened(result: Store2BootResult): Extract<Store2BootResult, { kind: 'store2' }> {
    if (result.kind !== 'store2') {
        throw new Error(`The boot answered ${result.kind}.`)
    }
    return result
}

function slots(result: Store2BootResult): Plain[] {
    return opened(result).database.characters as unknown as Plain[]
}

function resetPage(): void {
    resetStore2SaveForTest()
    resetResidencyForTest()
    resetStore2BootForTest()
    resetPageBlockOwnerForTests()
    resetPageStorageModeForTests()
    resetRetainedForTest()
}

/** One pass over `db` through the active save context, committed and acknowledged: what a save of `marked` writes. */
async function commitPass(db: Database, marked: string[]): Promise<void> {
    const context = getActiveStore2Save()
    const committer = context?.session.committer
    if (context === null || context.encoder === undefined || committer === null || committer === undefined) {
        throw new Error('No save context.')
    }
    const plan = await context.encoder.plan(db, { marked: new Set(marked), modules: false, whole: false })
    const result = await committer.commit(await committer.readCommit(), plan.commitRequest())
    expect(result.status).toBe('committed')
    plan.acknowledge()
}

beforeEach(() => {
    vi.clearAllMocks()
    resetPage()
    vi.spyOn(console, 'error').mockImplementation(() => { })
})

afterEach(() => {
    resetPage()
    vi.restoreAllMocks()
})

describe('R1: a boot opens the policy-eligible characters as stubs and reads none of their units', () => {
    test('every character of a profile that archives is a stub of its entry, and no character unit is read', async () => {
        const profile = await profileOf({ archiveCharacters: true })

        const boot = await bootThroughDispatch(profile.counted.backend)

        const characters = slots(boot.result)
        expect(characters.map(slot => slot.chaId).sort()).toEqual(profile.entries.map(entry => entry.chaId).sort())
        for (const entry of profile.entries) {
            const slot = characters.find(candidate => candidate.chaId === entry.chaId)
            expect(slot?.coldstorage, entry.name).toBe(entry.u)
            expect(slot?.name).toBe(entry.name)
        }
        const characterKeys = new Set(profile.entries.flatMap(unitKeysOf))
        expect(characterKeys.size).toBeGreaterThan(profile.entries.length * 3)
        expect(profile.counted.reads.length).toBeGreaterThan(0)
        expect(profile.counted.reads.filter(key => characterKeys.has(key))).toEqual([])
        expect(boot.notices.map(notice => notice.name)).toEqual([])
    })

    test('the first pass over the booted stubs writes nothing: every unit is carried', async () => {
        const profile = await profileOf({ archiveCharacters: true })
        const boot = await bootThroughDispatch(profile.counted.backend)
        const context = getActiveStore2Save()

        const plan = await context?.encoder?.plan(opened(boot.result).database, { marked: new Set(), modules: true, whole: true })

        expect(plan?.unchanged).toBe(true)
    })

    test('with archiving off, every character is resident and its units are read', async () => {
        const profile = await profileOf({ archiveCharacters: false })

        const boot = await bootThroughDispatch(profile.counted.backend)

        expect(slots(boot.result).every(slot => slot.coldstorage === undefined)).toBe(true)
        expect(slots(boot.result).map(slot => (slot.chats as unknown[]).length)).toEqual(profile.entries.map(entry => entry.chats.length))
        const characterKeys = new Set(profile.entries.flatMap(unitKeysOf))
        expect(profile.counted.reads.filter(key => characterKeys.has(key)).length).toBe(characterKeys.size)
        expect(boot.notices.map(notice => notice.name)).toEqual([])
    })
})

describe('boot policy: who stays resident', () => {
    test('a hidden, empty, unusable or shared id stays resident, and an ordinary one is a stub', async () => {
        const profile = await profileOf({ archiveCharacters: true }, (characters) => {
            characters[0].chaId = '§playground'
            characters[1].chaId = ''
            characters[2].chaId = 'preset'
            characters[3].chaId = 'twin'
            characters[4].chaId = 'twin'
        }, 6)

        const boot = await bootThroughDispatch(profile.counted.backend)

        const characters = slots(boot.result)
        expect(characters).toHaveLength(6)
        expect(characters.slice(0, 5).map(slot => slot.coldstorage)).toEqual([undefined, undefined, undefined, undefined, undefined])
        expect(typeof characters[5].coldstorage).toBe('string')
        // The residents were read whole, the stub was not.
        const stubKeys = new Set(profile.entries.filter(entry => entry.chaId === characters[5].chaId).flatMap(unitKeysOf))
        expect(profile.counted.reads.filter(key => stubKeys.has(key))).toEqual([])
        const residentKeys = profile.entries.filter(entry => entry.chaId !== characters[5].chaId).flatMap(unitKeysOf)
        expect(residentKeys.every(key => profile.counted.reads.includes(key))).toBe(true)
    })

    test('a group with a usable id is a stub like any character, and it names its members', async () => {
        const profile = await profileOf({ archiveCharacters: true }, (characters) => {
            Object.assign(characters[2], { type: 'group', chaId: 'group-one', name: 'Group One', characters: [characters[0].chaId, characters[1].chaId], characterTalks: [0.5, 0.5], characterActive: [true, true] })
        })

        const boot = await bootThroughDispatch(profile.counted.backend)

        const group = slots(boot.result).find(slot => slot.chaId === 'group-one') as Plain
        const entry = profile.entries.find(candidate => candidate.chaId === 'group-one') as ShardEntry
        expect(group.coldstorage).toBe(entry.u)
        expect(group.type).toBe('group')
        expect(group.characters).toEqual(slots(boot.result).filter(slot => slot.chaId !== 'group-one').map(slot => slot.chaId))
        expect(profile.counted.reads.filter(key => unitKeysOf(entry).includes(key))).toEqual([])
    })
})

describe('MC-142 1: a profile that never chose archiving', () => {
    test('is written true, told once with the existing notice text, and saved by the next pass', async () => {
        const profile = await profileOf()

        const boot = await bootThroughDispatch(profile.counted.backend)

        const database = opened(boot.result).database
        expect(database.archiveCharacters).toBe(true)
        const told = boot.notices.filter(notice => notice.name === 'archive-enabled')
        expect(told).toHaveLength(1)
        expect(noticeText(told[0])).toBe(language.archiveCharactersNotice(language.settings, language.advancedSettings, language.coldStorage))
        expect((await savedDatabase(profile.counted.memory)).archiveCharacters).toBeUndefined()
        await commitPass(database, [])
        expect((await savedDatabase(profile.counted.memory)).archiveCharacters).toBe(true)
    })

    test('a profile whose characters are all resident is written true and told once, whether or not anything became a stub (MC-149 3)', async () => {
        const profile = await profileOf({}, (characters) => {
            characters[0].chaId = '§playground'
            characters[1].chaId = ''
            characters[2].chaId = 'preset'
        })

        const boot = await bootThroughDispatch(profile.counted.backend)

        expect(slots(boot.result).every(slot => slot.coldstorage === undefined)).toBe(true)
        expect(opened(boot.result).database.archiveCharacters).toBe(true)
        expect(boot.notices.filter(notice => notice.name === 'archive-enabled')).toHaveLength(1)
    })

    test('a profile with no character at all is written true and told once', async () => {
        const profile = await profileOf({}, () => { }, 0)

        const boot = await bootThroughDispatch(profile.counted.backend)

        expect(slots(boot.result)).toHaveLength(0)
        expect(opened(boot.result).database.archiveCharacters).toBe(true)
        expect(boot.notices.filter(notice => notice.name === 'archive-enabled')).toHaveLength(1)
    })

    test('a boot that opens over a flagged leaf neither writes the setting nor tells; the next clean boot does, once', async () => {
        const profile = await profileOf({}, (characters) => { characters[0].chaId = '§playground' })
        const flaggedKey = keyOfRef(profile.entries.find(entry => entry.chaId === '§playground')!.core)
        const good = profile.counted.memory.snapshot().get(flaggedKey) as Uint8Array
        const flipped = new Uint8Array(good)
        flipped[FRAME_HEADER_BYTES + 1] ^= 0xff
        profile.counted.memory.poke(flaggedKey, flipped)

        const over = await bootThroughDispatch(profile.counted.backend, { flagged: 'continue' })

        expect(opened(over.result).database.archiveCharacters).toBeUndefined()
        expect(over.notices.map(notice => notice.name)).toEqual([])
        expect(profile.counted.writes).toEqual([])

        resetPage()
        profile.counted.memory.poke(flaggedKey, good)
        const clean = await bootThroughDispatch(profile.counted.backend, { flagged: 'continue' })

        expect(opened(clean.result).database.archiveCharacters).toBe(true)
        expect(clean.notices.filter(notice => notice.name === 'archive-enabled')).toHaveLength(1)
    })

    test('the next boot, with the key now saved, is not told', async () => {
        const profile = await profileOf()
        const first = await bootThroughDispatch(profile.counted.backend)
        await commitPass(opened(first.result).database, [])

        resetPage()
        const second = await bootThroughDispatch(profile.counted.backend)

        expect(opened(second.result).database.archiveCharacters).toBe(true)
        expect(second.notices.map(notice => notice.name)).toEqual([])
    })

    test('guard: a profile that chose, either way, is not told and keeps its choice', async () => {
        for (const chosen of [true, false]) {
            resetPage()
            const profile = await profileOf({ archiveCharacters: chosen })

            const boot = await bootThroughDispatch(profile.counted.backend)

            expect(opened(boot.result).database.archiveCharacters).toBe(chosen)
            expect(boot.notices.map(notice => notice.name)).toEqual([])
        }
    })
})

describe('the boot registers one residency over one context, before the save loop and the database', () => {
    test('the residency and the save loop are given the same context object, with the residency registered first', async () => {
        const profile = await profileOf({ archiveCharacters: true })

        const boot = await bootThroughDispatch(profile.counted.backend)
        opened(boot.result)

        expect(vi.mocked(createResidency)).toHaveBeenCalledTimes(1)
        expect(vi.mocked(activateStore2Save)).toHaveBeenCalledTimes(1)
        const [{ context }] = vi.mocked(createResidency).mock.calls[0]
        expect(context).toBe(vi.mocked(activateStore2Save).mock.calls[0][0])
        expect(context).toBe(getActiveStore2Save())
        expect(context.encoder).toBeDefined()
        expect(vi.mocked(registerResidency).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(activateStore2Save).mock.invocationCallOrder[0])
        // The residency reads through the loop's own encoding: a stub it loads has the unit it was assembled from.
        const stub = slots(boot.result)[0]
        const read = await getResidency()?.readCharacter(stub.coldstorage as string)
        expect(read?.status).toBe('ok')
        expect(getResidency()?.entryOf(stub.coldstorage as string)).toBe(context.encoder?.acknowledged().objects?.shards.flatMap(shard => shard.entries).find(entry => entry.u === stub.coldstorage))
    })

    test('guard: a boot the person declines registers no residency and activates no save loop', async () => {
        // A damaged leaf of a resident character asks a question that this port answers with a decline.
        const profile = await profileOf({ archiveCharacters: false })
        profile.counted.memory.poke(keyOfRef(profile.entries[0].chats[0].core), new Uint8Array([1, 2, 3]))

        const boot = await bootThroughDispatch(profile.counted.backend)

        expect(boot.result.kind).toBe('stopped')
        expect(getResidency()).toBeNull()
        expect(getActiveStore2Save()).toBeNull()
    })
})

describe('R5 (F2): a stub keeps the trash state a person gave it', () => {
    const NOW = 1_700_000_500_000

    /** Boots the profile afresh, as the next start of the page would. */
    async function reboot(profile: Profile) {
        resetPage()
        return bootThroughDispatch(profile.counted.backend)
    }

    /** A profile whose second character was trashed while it was a stub, and saved. */
    async function trashedProfile(): Promise<{ profile: Profile, chaId: string }> {
        const profile = await profileOf({ archiveCharacters: true })
        const chaId = profile.entries[1].chaId
        const first = await bootThroughDispatch(profile.counted.backend)
        const trashed = slots(first.result).find(slot => slot.chaId === chaId) as Plain
        expect(trashed.coldstorage).toBeDefined()
        expect(trashed.trashTime).toBeUndefined()
        // As `removeChar` does: the field on the stub and a mark for save.
        trashed.trashTime = NOW
        await commitPass(opened(first.result).database, [chaId])
        return { profile, chaId }
    }

    /** What "empty trash" would remove from `characters`: those that still carry a trash time. */
    const trashedOf = (characters: Plain[]) => characters.filter(slot => !!slot.trashTime)

    test('a stub trashed and saved is trashed at the next boot, and so is the character after it is loaded', async () => {
        const { profile, chaId } = await trashedProfile()

        const second = await reboot(profile)

        const stub = slots(second.result).find(slot => slot.chaId === chaId) as Plain
        expect(stub.coldstorage).toBeDefined()
        expect(stub.trashTime).toBe(NOW)
        ;(DBState as { db: unknown }).db = opened(second.result).database
        expect((await restoreColdCharacter(stub as unknown as character, { quiet: true })).status).toBe('restored')
        expect((DBState.db.characters as unknown as Plain[]).find(slot => slot.chaId === chaId)?.trashTime).toBe(NOW)
    })

    test('a stub restored from the trash and saved is not trashed after a reload, and "empty trash" keeps it', async () => {
        const { profile, chaId } = await trashedProfile()
        const second = await reboot(profile)
        const stub = slots(second.result).find(slot => slot.chaId === chaId) as Plain
        expect(stub.trashTime).toBe(NOW)

        // As `restoreCharacterFromTrash` does: the field cleared on the stub and a mark for save.
        stub.trashTime = undefined
        await commitPass(opened(second.result).database, [chaId])
        const third = await reboot(profile)

        const reloaded = slots(third.result)
        expect(reloaded.find(slot => slot.chaId === chaId)?.trashTime).toBeUndefined()
        expect(trashedOf(reloaded)).toEqual([])
        expect(reloaded.map(slot => slot.chaId).sort()).toEqual(profile.entries.map(entry => entry.chaId).sort())
        ;(DBState as { db: unknown }).db = opened(third.result).database
        const copy = await readColdCharacterCopy(reloaded.find(slot => slot.chaId === chaId) as unknown as character)
        expect(copy.status).toBe('ok')
        expect(copy.status === 'ok' ? copy.character.trashTime : 'unread').toBeUndefined()
    })
})

describe('MC-146 3: the Playground character through the store2 reader', () => {
    test('a hidden character is resident at boot, so the Playground chat never meets a stub of it', async () => {
        const profile = await profileOf({ archiveCharacters: true }, (characters) => { characters[0].chaId = '§playground' })

        const boot = await bootThroughDispatch(profile.counted.backend)

        expect(slots(boot.result)[0].coldstorage).toBeUndefined()
        expect(slots(boot.result).slice(1).every(slot => typeof slot.coldstorage === 'string')).toBe(true)
    })

    test('a stub of it that a page holds is restored whole, its chats kept, before the chat opens', async () => {
        const profile = await profileOf({ archiveCharacters: true }, (characters) => { characters[0].chaId = '§playground' })
        const boot = await bootThroughDispatch(profile.counted.backend)
        const database = opened(boot.result).database
        // The unloaded form of the resident character: what a stub of its entry is.
        const entry = profile.entries.find(candidate => candidate.chaId === '§playground') as ShardEntry
        ;(database.characters as unknown as Plain[])[0] = stubFromEntry(entry)
        ;(DBState as { db: unknown }).db = database

        const target = await restoreArchivedForWrite('§playground')

        expect(target.status).toBe('ready')
        const installed = (DBState.db.characters as unknown as Plain[])[0]
        expect(installed.coldstorage).toBeUndefined()
        expect((installed.chats as unknown[]).length).toBe(entry.chats.length)
    })

    test('a stub of it whose unit is damaged fails with one alert and stays a stub', async () => {
        const profile = await profileOf({ archiveCharacters: true }, (characters) => { characters[0].chaId = '§playground' })
        const boot = await bootThroughDispatch(profile.counted.backend)
        const database = opened(boot.result).database
        const entry = profile.entries.find(candidate => candidate.chaId === '§playground') as ShardEntry
        ;(database.characters as unknown as Plain[])[0] = stubFromEntry(entry)
        ;(DBState as { db: unknown }).db = database
        profile.counted.memory.poke(keyOfRef(entry.core), null)

        const target = await restoreArchivedForWrite('§playground')

        expect(target.status).toBe('failed')
        expect(vi.mocked(alertError)).toHaveBeenCalledTimes(1)
        expect((DBState.db.characters as unknown as Plain[])[0].coldstorage).toBe(entry.u)
    })
})

describe('the save loop\'s loadStub, handed over by the boot', () => {
    test('it loads every stub that holds the id from its units and answers true', async () => {
        const profile = await profileOf({ archiveCharacters: true })
        const boot = await bootThroughDispatch(profile.counted.backend)
        const database = opened(boot.result).database
        ;(DBState as { db: unknown }).db = database
        const chaId = profile.entries[0].chaId

        const loaded = await getActiveStore2Save()?.loadStub?.(chaId)

        expect(loaded).toBe(true)
        const characters = DBState.db.characters as unknown as Plain[]
        expect(characters.find(slot => slot.chaId === chaId)?.coldstorage).toBeUndefined()
        expect(characters.filter(slot => slot.chaId !== chaId).every(slot => typeof slot.coldstorage === 'string')).toBe(true)
    })

    test('a stub whose unit is damaged is not loaded, the answer is false and the stub stays', async () => {
        const profile = await profileOf({ archiveCharacters: true })
        const boot = await bootThroughDispatch(profile.counted.backend)
        ;(DBState as { db: unknown }).db = opened(boot.result).database
        const entry = profile.entries[0]
        profile.counted.memory.poke(keyOfRef(entry.core), null)

        const loaded = await getActiveStore2Save()?.loadStub?.(entry.chaId)

        expect(loaded).toBe(false)
        expect((DBState.db.characters as unknown as Plain[]).find(slot => slot.chaId === entry.chaId)?.coldstorage).toBe(entry.u)
    })
})
