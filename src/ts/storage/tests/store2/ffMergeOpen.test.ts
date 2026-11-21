// @vitest-environment node
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

import type { Database } from 'src/ts/storage/database.svelte'
import { isColdStub } from 'src/ts/storage/store2/codec'
import { chaIdOf, chars, clone, until } from './lineFixtures'
import { createMemoryBackend } from 'src/ts/storage/store2/backend'
import { createFastForward } from 'src/ts/storage/store2/fastForward'
import { defaultKeyEnv } from 'src/ts/storage/store2/format'
import { fakeLists } from './codecFixtures'
import { chatsAt, FF_HOSTS, ffSetup, ffTeardown, mergeWorld, peerCommits, personalityOf, signal, useFfHost, type MergeWorld } from './ffFixtures'

/**
 * Stage 3B: the library shapes around the per-record merge. A resident id (`§`) is merged in place where stage 1 parked;
 * a clean character that is not open keeps the stage-1 stub install; a repeated chaId keeps today's parks and the
 * stage-1 append (the membership domain guard).
 */

let hostHandle: ReturnType<typeof ffSetup>

beforeEach(() => {
    hostHandle = ffSetup()
})

afterEach(() => {
    ffTeardown()
})

type Slots = unknown[]

function remove(db: Database, index: number): void {
    const id = chaIdOf(db, index)
    ;(db.characters as unknown as Slots).splice(index, 1)
    db.characterOrder = db.characterOrder.filter(item => item !== id)
}

function append(db: Database, chaId: string): void {
    const added = clone(chars(db)[0])
    added.chaId = chaId
    added.name = `Appended ${chaId}`
    ;(db.characters as unknown as Slots).push(added)
    db.characterOrder = [...db.characterOrder, chaId]
}

/** A profile in which character 2 has a hidden (resident) id. */
function residentWorld(): Promise<MergeWorld> {
    return mergeWorld({
        before: async (page) => {
            await page.commitEdit((db) => {
                const old = chaIdOf(db, 2)
                chars(db)[2].chaId = '§hidden-id'
                db.characterOrder = db.characterOrder.map(item => item === old ? '§hidden-id' : item)
            })
        },
    })
}

/** A profile in which characters 1 and 2 share one chaId. */
function repeatedWorld(): Promise<MergeWorld> {
    return mergeWorld({
        before: async (page) => {
            await page.commitEdit((db) => {
                const old = chaIdOf(db, 2)
                chars(db)[2].chaId = chaIdOf(db, 1)
                db.characterOrder = db.characterOrder.map(item => item === old ? chaIdOf(db, 1) : item)
            })
        },
    })
}

/** Writes an object into the page database under an unused top-level key and reports whether it reads back as the same object. */
async function readsBackIdentical(): Promise<boolean> {
    const w = await mergeWorld()
    const written = { probe: 'host' }
    Reflect.set(w.b.db, 'hostProbe', written)
    return Reflect.get(w.b.db, 'hostProbe') === written
}

describe('the default host (H0)', () => {
    test('H0 default: the page database is the state host unless FF_TEST_HOST=plain selects the plain one', async () => {
        expect(await readsBackIdentical()).toBe(process.env.FF_TEST_HOST === 'plain')
    })
})

describe('the plain host (H0)', () => {
    useFfHost('plain')
    test('H0 plain: an object written into the page database reads back identical', async () => {
        expect(await readsBackIdentical()).toBe(true)
    })
})

describe.each(FF_HOSTS)('resident id and the stage-1 stub install (%s host)', (mode) => {
    useFfHost(mode)
    test('R7 a loaded character with a resident id the peer edited is taken in place where stage 1 parked resident-id', async () => {
        const w = await residentWorld()
        const owner = chars(w.b.db)[2]
        const chatArray = chatsAt(w.b.db, 2)
        const outcome = await peerCommits(w, (db) => { chars(db)[2].personality = 'peer card' })
        expect(outcome).toEqual({ kind: 'applied' })
        expect(personalityOf(w.b.db, 2)).toBe('peer card')
        expect(chars(w.b.db)[2]).toBe(owner)
        expect(chatsAt(w.b.db, 2)).toBe(chatArray)
    })

    test('C4 a clean character that is not open and not resident still becomes the peer\'s stub', async () => {
        const w = await mergeWorld()
        const outcome = await peerCommits(w, (db) => { chars(db)[3].personality = 'peer card' })
        expect(outcome).toEqual({ kind: 'applied' })
        expect(isColdStub(chars(w.b.db)[3])).toBe(true)
    })

    test('R19 a resident id gets no delete row: B edited it and A deletes it parks not-append; B deleted it and A edited it parks character-missing', async () => {
        const there = await residentWorld()
        chatsAt(there.b.db, 2)[0].note = 'edited here'
        expect(await peerCommits(there, db => remove(db, 2))).toEqual({ kind: 'park', reason: 'membership:not-append' })
        ffTeardown()
        hostHandle = ffSetup()
        const here = await residentWorld()
        remove(here.b.db, 2)
        expect(await peerCommits(here, (db) => { chars(db)[2].personality = 'peer card' })).toEqual({ kind: 'park', reason: 'character-missing' })
    })
})

describe.each(FF_HOSTS)('a repeated chaId keeps today\'s membership rules (%s host)', (mode) => {
    useFfHost(mode)
    test('C2 a shared chaId the peer changed parks shared-id', async () => {
        const w = await repeatedWorld()
        const outcome = await peerCommits(w, (db) => { chars(db)[1].personality = 'peer card' })
        expect(outcome).toEqual({ kind: 'park', reason: 'character:shared-id' })
    })

    test('R17 outside the domain a peer removal parks membership:not-append, edited here or not, and nothing changes', async () => {
        const first = await repeatedWorld()
        const before = JSON.stringify(first.b.db.characters)
        expect(await peerCommits(first, db => remove(db, 3))).toEqual({ kind: 'park', reason: 'membership:not-append' })
        expect(JSON.stringify(first.b.db.characters)).toBe(before)
        ffTeardown()
        hostHandle = ffSetup()
        const second = await repeatedWorld()
        chatsAt(second.b.db, 3)[0].note = 'edited here'
        expect(await peerCommits(second, db => remove(db, 3))).toEqual({ kind: 'park', reason: 'membership:not-append' })
        expect(chatsAt(second.b.db, 3)[0].note).toBe('edited here')
    })

    test('G4c outside the domain a peer append is taken as stage 1 takes it: the stub is last, no check-a park', async () => {
        const w = await repeatedWorld()
        const outcome = await peerCommits(w, db => append(db, 'appended-last'))
        expect(outcome).toEqual({ kind: 'applied' })
        expect(chaIdOf(w.b.db, chars(w.b.db).length - 1)).toBe('appended-last')
        expect(isColdStub(chars(w.b.db)[chars(w.b.db).length - 1])).toBe(true)
    })

    /** The peer's `u` of the appended entry `chaId`, from the encoding the page acknowledged after its take. */
    const peerUnitOf = (w: MergeWorld, chaId: string): unknown => w.b.context.encoder.acknowledged().objects?.shards.flatMap(shard => shard.entries).find(entry => entry.chaId === chaId)?.u

    test('T29 outside the domain a peer that appends two characters is taken: each append step verifies its own installed slot, whatever the order of the verifies', async () => {
        const w = await repeatedWorld()
        const outcome = await peerCommits(w, (db) => {
            append(db, 'app-one')
            append(db, 'app-two')
        })
        expect(outcome).toEqual({ kind: 'applied' })
        const tail = chars(w.b.db).slice(-2)
        expect(tail.map(slot => String(slot.chaId))).toEqual(['app-one', 'app-two'])
        expect(tail.map(slot => Reflect.get(slot, 'coldstorage'))).toEqual([peerUnitOf(w, 'app-one'), peerUnitOf(w, 'app-two')])
        expect(tail.every(slot => isColdStub(slot))).toBe(true)
    })

    test('T30 the same take with an own unsaved edit asks nothing, and the next own pass saves both appended characters and the edit', async () => {
        const w = await repeatedWorld()
        const own = chars(w.b.db)[3]
        own.personality = 'own edit char3'
        w.world.tracker.character.push(String(own.chaId))
        w.world.state.dirty = true
        const outcome = await peerCommits(w, (db) => {
            append(db, 'app-one')
            append(db, 'app-two')
        })
        expect(outcome).toEqual({ kind: 'applied' })
        expect(w.b.peer.asked).toEqual([])
        const saved = w.world.state.saved
        w.world.state.dirty = true
        w.world.state.due = true
        await until(() => w.world.state.saved > saved, 'the own pass', 8000)
        const read = await w.page.freeze()
        const ids = chars(read.db).map(slot => String(slot.chaId))
        expect(ids).toContain('app-one')
        expect(ids).toContain('app-two')
        expect(ids.indexOf('app-one')).toBeLessThan(ids.indexOf('app-two'))
        expect(personalityOf(read.db, 3)).toBe('own edit char3')
        expect(w.world.failures).toEqual([])
    })
})

describe.each(FF_HOSTS)('what stays out of the merge (C1, C3) (%s host)', (mode) => {
    useFfHost(mode)
    test('C1 a page of any other kind never fast-forwards, and a page without a fast-forward parks a body change clean with today\'s offers and changes nothing', async () => {
        for (const kind of ['tauri'] as const) {
            const fastForward = createFastForward({ backend: createMemoryBackend(), kind: kind as 'tauri', lists: fakeLists, env: defaultKeyEnv })
            expect(await fastForward.run({} as never)).toEqual({ kind: 'park', reason: 'kind' })
        }
        const w = await mergeWorld()
        w.b.context.fastForward = undefined
        const before = personalityOf(w.b.db, 3)
        await w.page.commitEdit((db) => { chars(db)[3].personality = 'peer card' })
        signal(w.world)
        await until(() => w.b.peer.clean.length >= 1, 'the clean notice', 8000)
        expect(w.b.peer.clean[0].offers).toEqual(['reload'])
        expect(personalityOf(w.b.db, 3)).toBe(before)
    })

    test('C3 a peer change to the installed modules or to the plugin storage still parks with today\'s prompt and applies nothing', async () => {
        for (const edit of [
            (db: Database) => { Reflect.set(db, 'modules', [{ id: 'module-peer', name: 'Peer module', description: '', lorebook: [] }]) },
            (db: Database) => { Reflect.set(db, 'pluginCustomStorage', { 'peer-key': 'peer value' }) },
        ]) {
            hostHandle = ffSetup()
            const w = await mergeWorld()
            const before = JSON.stringify(w.b.db)
            const outcome = await peerCommits(w, edit)
            expect(outcome.kind).toBe('park')
            await until(() => w.b.peer.clean.length >= 1, 'the clean notice', 8000)
            expect(JSON.stringify(w.b.db)).toBe(before)
            ffTeardown()
        }
    })
})
