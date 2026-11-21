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
import { chaIdOf, chars, until } from './lineFixtures'
import type { OpenedBackend } from './fenceFixtures'
import { chatsAt, ffSetup, ffTeardown, mergeWorld, openNamed, peerCommits, personalityOf, resolver, signal, takenBy, type MergeWorld } from './ffFixtures'

/**
 * Stage 3C answers: keep mine, keep theirs and keep both are applied by the next pass under the write lock, a record at a
 * time, and the kept version reaches the store with the next own commit.
 */

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let hostHandle: ReturnType<typeof ffSetup>
let opened: OpenedBackend | null = null

beforeEach(() => {
    hostHandle = ffSetup()
})

afterEach(async () => {
    ffTeardown()
    await opened?.close()
    opened = null
})

function remove(db: Database, index: number): void {
    const id = chaIdOf(db, index)
    ;(db.characters as unknown as unknown[]).splice(index, 1)
    db.characterOrder = db.characterOrder.filter(item => item !== id)
}

const order = (w: MergeWorld): string[] => chars(w.b.db).map(slot => String(slot.chaId))

/** Waits until the store holds what holds accepts (the next own commit of the page) and returns it. */
async function storeHolds(w: MergeWorld, holds: (db: Database) => boolean) {
    await until(async () => holds((await w.page.freeze()).db), 'the own commit', 8000)
    return w.page.freeze()
}

describe('a record both sides changed', () => {
    test('P10 keep theirs for the card writes the peer\'s card into the same owner object, and the commit that follows holds it', async () => {
        const w = await mergeWorld()
        const { b } = w
        const owner = chars(b.db)[3]
        const held = resolver(w, () => 'theirs')
        chars(b.db)[3].personality = 'mine card'
        await peerCommits(w, (db) => { chars(db)[3].personality = 'peer card' })
        await takenBy(b, w.memory)
        expect(held.calls).toHaveLength(1)
        expect(chars(b.db)[3]).toBe(owner)
        expect(personalityOf(b.db, 3)).toBe('peer card')
        expect(b.peer.asked).toEqual([])
    })

    test('keep mine for the card leaves this page\'s card, marks the character, and the next commit writes it over the peer\'s', async () => {
        const w = await mergeWorld()
        const { b } = w
        resolver(w, () => 'mine')
        chars(b.db)[3].personality = 'mine card'
        await peerCommits(w, (db) => { chars(db)[3].personality = 'peer card' })
        await takenBy(b, w.memory)
        expect(personalityOf(b.db, 3)).toBe('mine card')
        const frozen = await storeHolds(w, db => personalityOf(db, 3) === 'mine card')
        expect(personalityOf(frozen.db, 3)).toBe('mine card')
    })

    test('a setting: keep theirs takes the peer\'s value, keep mine keeps this page\'s and the next commit writes it', async () => {
        const first = await mergeWorld()
        resolver(first, () => 'theirs')
        first.b.db.zoomsize = 11
        await peerCommits(first, (db) => { db.zoomsize = 22 })
        await takenBy(first.b, first.memory)
        expect(first.b.db.zoomsize).toBe(22)
        ffTeardown()
        hostHandle = ffSetup()
        const second = await mergeWorld()
        resolver(second, () => 'mine')
        second.b.db.zoomsize = 11
        second.world.state.dirty = true
        await peerCommits(second, (db) => { db.zoomsize = 22 })
        await takenBy(second.b, second.memory)
        expect(second.b.db.zoomsize).toBe(11)
        const frozen = await storeHolds(second, db => db.zoomsize === 11)
        expect(frozen.db.zoomsize).toBe(11)
    })

    test('the preset record both sides changed is one row; keep theirs takes the peer\'s settings', async () => {
        const w = await mergeWorld()
        const held = resolver(w, () => 'theirs')
        w.b.db.temperature = 0.31
        await peerCommits(w, (db) => { db.temperature = 0.62 })
        await takenBy(w.b, w.memory)
        expect(held.calls[0].map(record => record.id)).toEqual(['presets'])
        expect(w.b.db.temperature).toBe(0.62)
    })

    test('a chat deleted by the peer and changed here is a two-choice row: keep mine keeps the chat, keep theirs removes it', async () => {
        const keep = await mergeWorld()
        const cid = String(chatsAt(keep.b.db, 3)[1].id)
        const held = resolver(keep, () => 'mine')
        chatsAt(keep.b.db, 3)[1].note = 'mine note'
        await peerCommits(keep, (db) => { chatsAt(db, 3).splice(1, 1) })
        await takenBy(keep.b, keep.memory)
        expect(held.calls[0][0]).toMatchObject({ id: `char:${chaIdOf(keep.b.db, 3)}:chat:${cid}:deletedThere`, choices: ['mine', 'theirs'], keepBoth: null, preselect: 'mine' })
        expect(chatsAt(keep.b.db, 3).map(chat => String(chat.id))).toContain(cid)
        expect(chatsAt(keep.b.db, 3)[1].note).toBe('mine note')
        ffTeardown()
        hostHandle = ffSetup()
        const drop = await mergeWorld()
        resolver(drop, () => 'theirs')
        chatsAt(drop.b.db, 3)[1].note = 'mine note'
        await peerCommits(drop, (db) => { chatsAt(db, 3).splice(1, 1) })
        await takenBy(drop.b, drop.memory)
        expect(chatsAt(drop.b.db, 3).map(chat => String(chat.id))).not.toContain(cid)
    })

    test('a chat deleted here and changed by the peer: keep theirs brings it back with the peer\'s content', async () => {
        const w = await mergeWorld()
        const cid = String(chatsAt(w.b.db, 3)[1].id)
        const held = resolver(w, () => 'theirs')
        chatsAt(w.b.db, 3).splice(1, 1)
        await peerCommits(w, (db) => { chatsAt(db, 3)[1].note = 'peer note' })
        await takenBy(w.b, w.memory)
        expect(held.calls[0][0]).toMatchObject({ id: `char:${chaIdOf(w.b.db, 3)}:chat:${cid}:deletedHere`, preselect: 'theirs' })
        const back = chatsAt(w.b.db, 3).find(chat => String(chat.id) === cid)
        expect(back?.note).toBe('peer note')
    })
})

describe('a character deleted on one side and edited on the other', () => {
    test('P11 keep mine: D stays, is listed at the top-level end, and the next commit writes it; the peer\'s next fast-forward needs no question', async () => {
        const w = await mergeWorld()
        const { b } = w
        const id = chaIdOf(b.db, 1)
        resolver(w, () => 'mine')
        chars(b.db)[1].personality = 'mine edit of D'
        await peerCommits(w, db => remove(db, 1))
        await takenBy(b, w.memory)
        expect(order(w)).toContain(id)
        expect(b.db.characterOrder).toContain(id)
        expect(personalityOf(b.db, order(w).indexOf(id))).toBe('mine edit of D')
        const frozen = await storeHolds(w, db => (db.characters as unknown as Array<Record<string, unknown>>).some(slot => String(slot.chaId) === id))
        expect((frozen.db.characters as unknown as Array<Record<string, unknown>>).map(slot => String(slot.chaId))).toContain(id)
        expect(b.peer.asked).toEqual([])
    })

    test('R13 keep theirs: D comes back as the peer\'s stub, placed by the target, and is listed', async () => {
        const w = await mergeWorld()
        const { b } = w
        const id = chaIdOf(b.db, 1)
        const neighbours = [chaIdOf(b.db, 0), chaIdOf(b.db, 2)]
        resolver(w, () => 'theirs')
        remove(b.db, 1)
        await peerCommits(w, (db) => { chars(db)[1].personality = 'peer edit of D' })
        await takenBy(b, w.memory)
        expect(order(w).slice(0, 3)).toEqual([neighbours[0], id, neighbours[1]])
        expect(b.db.characterOrder).toContain(id)
    })

    test('R21 (i) D that sat in a folder and is kept returns at the top-level end', async () => {
        const w = await mergeWorld({
            before: async (page) => {
                await page.commitEdit((db) => {
                    const id = chaIdOf(db, 1)
                    db.characterOrder = [...db.characterOrder.filter(item => item !== id), { name: 'Folder', data: [id] } as never]
                })
            },
        })
        const { b } = w
        const id = chaIdOf(b.db, 1)
        resolver(w, () => 'mine')
        chars(b.db)[1].personality = 'mine edit of D'
        await peerCommits(w, (db) => {
            remove(db, 1)
            db.characterOrder = db.characterOrder.map(item => typeof item === 'string' ? item : { ...item, data: item.data.filter((entry: string) => entry !== id) })
        })
        await takenBy(b, w.memory)
        const named = b.db.characterOrder.filter((item): item is string => typeof item === 'string')
        expect(named[named.length - 1]).toBe(id)
    })
})


describe('the answer is judged again against the newest tree (P5b) and on a node page (P6)', () => {
    test('P5b keep mine is answered for the card, then the peer commits another edit to it before the pass: the card is asked again with the new peer version', async () => {
        const w = await mergeWorld()
        const { b } = w
        const chaId = chaIdOf(b.db, 3)
        const calls: string[][] = []
        const peerSeen: string[] = []
        b.peer.resolve = async ({ conflicts }) => {
            calls.push(conflicts.map(record => record.id))
            peerSeen.push(conflicts[0].fingerprint.theirs)
            if (calls.length === 1) {
                // The person answers, but a second peer commit lands before the pass that applies the answer.
                await w.page.commitEdit((db) => { chars(db)[3].personality = 'peer card two' })
                signal(w.world)
            }
            return Object.fromEntries(conflicts.map(record => [record.id, 'mine' as const]))
        }
        chars(b.db)[3].personality = 'mine card'
        await peerCommits(w, (db) => { chars(db)[3].personality = 'peer card' })
        await until(() => calls.length === 2, 'the second dialog', 8000)
        expect(calls).toEqual([[`char:${chaId}:core`], [`char:${chaId}:core`]])
        expect(peerSeen[0]).not.toBe(peerSeen[1])
        await takenBy(b, w.memory)
        expect(personalityOf(b.db, 3)).toBe('mine card')
    })

    test('P6 a node page asks the same dialog: no automatic export, no Save mine, and the resolution is an ordinary commit', async () => {
        opened = await openNamed('node')
        const w = await mergeWorld({ backend: opened.backend })
        const { b } = w
        expect(b.context.session.kind).toBe('node')
        const held = resolver(w, () => 'theirs')
        const saveMine = vi.spyOn(b.context.session.committer, 'saveMine')
        chars(b.db)[3].personality = 'mine card'
        w.world.state.dirty = true
        await peerCommits(w, (db) => { chars(db)[3].personality = 'peer card' })
        await takenBy(b, w.memory)
        expect(held.calls).toHaveLength(1)
        expect(personalityOf(b.db, 3)).toBe('peer card')
        expect(b.peer.autoExports).toEqual([])
        expect(b.peer.asked).toEqual([])
        expect(saveMine).not.toHaveBeenCalled()
    })
})
