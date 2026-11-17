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
import { isColdStub, stubFromEntry } from 'src/ts/storage/store2/codec'
import { applyVerified } from 'src/ts/storage/store2/fastForward/apply'
import { insertionStep, orderVerifyStep } from 'src/ts/storage/store2/fastForward/prepare'
import { recordTrashOrigins } from 'src/ts/trashOrigin'
import { chaIdOf, chars, clone, until } from './lineFixtures'
import { chatsAt, ffSetup, ffTeardown, mergeWorld, peerCommits, testHost, type MergeWorld } from './ffFixtures'

/**
 * Stage 3B membership rows: a peer removal or insertion at any position is taken in place, the selection follows the
 * same character by identity, and a deletion against an edit parks with today's prompt (3C adds the dialog).
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

function insert(db: Database, index: number, chaId: string): void {
    const added = clone(chars(db)[0])
    added.chaId = chaId
    added.name = `Inserted ${chaId}`
    ;(db.characters as unknown as Slots).splice(index, 0, added)
    db.characterOrder = [...db.characterOrder, chaId]
}

const order = (w: MergeWorld): string[] => chars(w.b.db).map(slot => String(slot.chaId))

function stubOf(w: MergeWorld, index: number): void {
    const chaId = chaIdOf(w.b.db, index)
    const entry = w.b.context.encoder.acknowledged().objects?.shards.flatMap(shard => shard.entries).find(candidate => candidate.chaId === chaId)
    if (entry === undefined) {
        throw new Error('No acknowledged entry.')
    }
    ;(w.b.db.characters as unknown as Slots)[index] = stubFromEntry(entry)
}

describe('removal, insertion and the selection', () => {
    test('R9 A permanently deletes an unedited character: it is removed, and the selection names the same character', async () => {
        const w = await mergeWorld()
        const kept = chaIdOf(w.b.db, 3)
        const removed = chaIdOf(w.b.db, 1)
        hostHandle.host.state.selected = 3
        const outcome = await peerCommits(w, db => remove(db, 1))
        expect(outcome).toEqual({ kind: 'applied' })
        expect(order(w)).not.toContain(removed)
        expect(hostHandle.host.state.selected).toBe(2)
        expect(chaIdOf(w.b.db, 2)).toBe(kept)
        expect(w.b.peer.asked).toEqual([])
        expect(w.b.peer.clean).toEqual([])
    })

    test('R12 A permanently deletes the open, unedited character: it is removed and nothing is selected', async () => {
        const w = await mergeWorld()
        const id = chaIdOf(w.b.db, 1)
        hostHandle.host.state.selected = 1
        hostHandle.host.state.inUse.add(id)
        const outcome = await peerCommits(w, db => remove(db, 1))
        expect(outcome).toEqual({ kind: 'applied' })
        expect(order(w)).not.toContain(id)
        expect(hostHandle.host.state.selected).toBe(-1)
    })

    test('R12c the open character B only switched chats in is removed all the same: a view change is not an edit', async () => {
        const w = await mergeWorld()
        const id = chaIdOf(w.b.db, 1)
        hostHandle.host.state.selected = 1
        hostHandle.host.state.inUse.add(id)
        chars(w.b.db)[1].chatPage = 1
        const outcome = await peerCommits(w, db => remove(db, 1))
        expect(outcome).toEqual({ kind: 'applied' })
        expect(order(w)).not.toContain(id)
        expect(hostHandle.host.state.selected).toBe(-1)
    })

    test('R15 A inserts a character at index 1: B has it there as a stub and its selection follows the same character', async () => {
        const w = await mergeWorld()
        const kept = chaIdOf(w.b.db, 3)
        hostHandle.host.state.selected = 3
        const outcome = await peerCommits(w, db => insert(db, 1, 'inserted-by-peer'))
        expect(outcome).toEqual({ kind: 'applied' })
        expect(chaIdOf(w.b.db, 1)).toBe('inserted-by-peer')
        expect(isColdStub(chars(w.b.db)[1])).toBe(true)
        expect(hostHandle.host.state.selected).toBe(4)
        expect(chaIdOf(w.b.db, 4)).toBe(kept)
    })

    test('G4 a removal, an insertion, a stub install and an append in one fast-forward each find their own slot, and the selection follows an installed stub', async () => {
        const w = await mergeWorld()
        const selectedId = chaIdOf(w.b.db, 2)
        const successorId = chaIdOf(w.b.db, 3)
        hostHandle.host.state.selected = 2
        const outcome = await peerCommits(w, (db) => {
            chars(db)[2].personality = 'peer body'
            insert(db, 3, 'inserted-mid')
            remove(db, 0)
            insert(db, db.characters.length, 'appended-last')
        })
        expect(outcome).toEqual({ kind: 'applied' })
        const ids = order(w)
        expect(ids[0]).not.toBe(undefined)
        expect(ids).toContain('inserted-mid')
        expect(ids[ids.indexOf('inserted-mid') + 1]).toBe(successorId)
        expect(ids[ids.length - 1]).toBe('appended-last')
        expect(chaIdOf(w.b.db, hostHandle.host.state.selected ?? -1)).toBe(selectedId)
        expect(isColdStub(chars(w.b.db)[ids.indexOf(selectedId)])).toBe(true)
        expect(hostHandle.host.state.calls?.forgotten.length).toBeGreaterThanOrEqual(2)
    })

    test('G4c (anchor) a mid-list insertion whose successor the same commit edits applies when the successor is loaded and clean: the insertion follows the stub that replaced it', async () => {
        const w = await mergeWorld()
        const successorId = chaIdOf(w.b.db, 2)
        const outcome = await peerCommits(w, (db) => {
            chars(db)[2].personality = 'peer body'
            insert(db, 2, 'inserted-mid')
        })
        expect(outcome).toEqual({ kind: 'applied' })
        expect(chaIdOf(w.b.db, 2)).toBe('inserted-mid')
        expect(chaIdOf(w.b.db, 3)).toBe(successorId)
    })

    test('G4c (anchor) the same insertion applies when the edited successor is a stub on this page', async () => {
        const w = await mergeWorld()
        stubOf(w, 2)
        const successorId = chaIdOf(w.b.db, 2)
        const outcome = await peerCommits(w, (db) => {
            chars(db)[2].personality = 'peer body'
            insert(db, 2, 'inserted-mid')
        })
        expect(outcome).toEqual({ kind: 'applied' })
        expect(chaIdOf(w.b.db, 2)).toBe('inserted-mid')
        expect(chaIdOf(w.b.db, 3)).toBe(successorId)
    })
})

describe('a removal against an edit parks with today\'s prompt', () => {
    test('R18 (i) a stub that still shows its entry is removed by a peer deletion; (ii) a renamed stub parks membership:not-append', async () => {
        const first = await mergeWorld()
        stubOf(first, 1)
        const id = chaIdOf(first.b.db, 1)
        expect(await peerCommits(first, db => remove(db, 1))).toEqual({ kind: 'applied' })
        expect(order(first)).not.toContain(id)
        ffTeardown()
        hostHandle = ffSetup()
        const second = await mergeWorld()
        stubOf(second, 1)
        chars(second.b.db)[1].name = 'renamed while unloaded'
        const outcome = await peerCommits(second, db => remove(db, 1))
        expect(outcome).toEqual({ kind: 'park', reason: 'membership:not-append' })
        expect(chars(second.b.db)[1].name).toBe('renamed while unloaded')
    })

    test('R20 B deleted D, A only touched D\'s view, last interaction or trash time: B\'s deletion stands with no park', async () => {
        for (const touch of [
            (db: Database) => { chars(db)[1].lastInteraction = 4_000_000_000_000 },
            (db: Database) => { chars(db)[1].chatPage = 1 },
            (db: Database) => { chars(db)[1].trashTime = 4_000_000_000_001 },
        ]) {
            hostHandle = ffSetup()
            const w = await mergeWorld()
            const id = chaIdOf(w.b.db, 1)
            remove(w.b.db, 1)
            const outcome = await peerCommits(w, touch)
            expect(outcome).toEqual({ kind: 'applied' })
            expect(order(w)).not.toContain(id)
            expect(w.b.peer.asked).toEqual([])
            ffTeardown()
        }
    })

    test('R20 B deleted D and A edited D\'s card: deletedHere parks (the dialog is 3C); B deleted nothing and A deleted D that B edited: deletedThere parks', async () => {
        const w = await mergeWorld()
        const id = chaIdOf(w.b.db, 1)
        remove(w.b.db, 1)
        expect(await peerCommits(w, (db) => { chars(db)[1].personality = 'peer edit of the card' })).toEqual({ kind: 'park', reason: `conflict:char:${id}:deletedHere` })
        ffTeardown()
        hostHandle = ffSetup()
        const there = await mergeWorld()
        chats(there)[0].note = 'edited here'
        const outcome = await peerCommits(there, db => remove(db, 1))
        expect(outcome).toEqual({ kind: 'park', reason: `conflict:char:${chaIdOf(there.b.db, 1)}:deletedThere` })
        expect(order(there)).toContain(chaIdOf(there.b.db, 1))
    })
})

function chats(w: MergeWorld): Array<Record<string, unknown>> {
    return chatsAt(w.b.db, 1)
}

/** A character trashed as the app does: `trashTime`, its origin record, and no place in the order. */
function trash(db: Database, index: number, at: number): void {
    const slot = chars(db)[index]
    slot.trashTime = at
    recordTrashOrigins(db, [{ chaId: String(slot.chaId) }], at)
    db.characterOrder = db.characterOrder.filter(item => item !== slot.chaId)
}

describe('removals the table names (R20 follow-through, R22)', () => {
    test('R20b B deleted D and A only opened it: B\'s next commit lands without D', async () => {
        const w = await mergeWorld()
        const id = chaIdOf(w.b.db, 1)
        remove(w.b.db, 1)
        expect(await peerCommits(w, (db) => { chars(db)[1].lastInteraction = 4_000_000_000_000 })).toEqual({ kind: 'applied' })
        expect(order(w)).not.toContain(id)
        const saved = w.world.state.saved
        w.world.mark(chaIdOf(w.b.db, 0))
        await until(() => w.world.state.saved > saved, 'the own commit', 8000)
        const read = await w.page.freeze()
        expect(chars(read.db).map(slot => String(slot.chaId))).not.toContain(id)
        expect(read.db.characterOrder).not.toContain(id)
    })

    test('R22 (i) a group member A deletes is removed here while the group is not sending, and the group still names it', async () => {
        const w = await mergeWorld({
            before: async (page) => {
                await page.commitEdit((db) => {
                    const group = chars(db)[3]
                    group.type = 'group'
                    group.characters = [chaIdOf(db, 2), chaIdOf(db, 1)]
                })
            },
        })
        const member = chaIdOf(w.b.db, 1)
        const outcome = await peerCommits(w, db => remove(db, 1))
        expect(outcome).toEqual({ kind: 'applied' })
        expect(order(w)).not.toContain(member)
        const group = chars(w.b.db).find(slot => slot.type === 'group')
        expect(group).toBeDefined()
        expect(group?.characters).toContain(member)
        expect(w.b.peer.asked).toEqual([])
    })

    test('R22 (ii) emptying the trash removes a trashed character here, and the origin records equal the peer\'s', async () => {
        const at = Date.now()
        const w = await mergeWorld({ before: async (page) => { await page.commitEdit((db) => { trash(db, 1, at) }) } })
        const id = chaIdOf(w.b.db, 1)
        expect(chars(w.b.db)[1].trashTime).toBe(at)
        const outcome = await peerCommits(w, (db) => {
            // What "Empty trash" writes: the slot is gone and its origin record is pruned with it.
            ;(db.characters as unknown as Slots).splice(1, 1)
            db.trashOrigins = (db.trashOrigins ?? []).filter(record => record.chaId !== id)
        })
        expect(outcome).toEqual({ kind: 'applied' })
        expect(order(w)).not.toContain(id)
        const read = await w.page.freeze()
        expect(w.b.db.trashOrigins ?? []).toEqual(read.db.trashOrigins ?? [])
        expect(w.b.peer.asked).toEqual([])
    })

    test('R22 (iii) B trashed D and nothing else, A permanently deletes D: D is removed here with no question', async () => {
        const w = await mergeWorld()
        const id = chaIdOf(w.b.db, 1)
        trash(w.b.db, 1, Date.now())
        const outcome = await peerCommits(w, db => remove(db, 1))
        expect(outcome).toEqual({ kind: 'applied' })
        expect(order(w)).not.toContain(id)
        expect(w.b.peer.asked).toEqual([])
        expect(w.b.peer.clean).toEqual([])
    })
})
describe('membership steps through the real apply (G4b, K3)', () => {
    const plain = (...ids: string[]): { characters: Array<Record<string, unknown>> } => ({ characters: ids.map(chaId => ({ chaId })) })

    test('G4b insertions placed out of target order fail the order verify, and the journal restores the original objects in the original order', () => {
        const db = plain('X', 'S')
        const { host } = testHost()
        const held = [...db.characters]
        const asDb = db as unknown as Database
        const [d1, d2] = [{ chaId: 'D1' }, { chaId: 'D2' }] as unknown as Array<Database['characters'][number]>
        const steps = [
            insertionStep(asDb, host, d1, null),
            insertionStep(asDb, host, d2, db.characters[1] as unknown as Database['characters'][number]),
            orderVerifyStep(asDb, ['X', 'D1', 'D2', 'S']),
        ]
        expect(applyVerified(steps).result).toBe('check-failed')
        expect(db.characters).toHaveLength(2)
        expect(db.characters.every((slot, index) => slot === held[index])).toBe(true)
    })

    test('G4b the same insertions in reverse target order pass the verify', () => {
        const db = plain('X', 'S')
        const { host } = testHost()
        const asDb = db as unknown as Database
        const [d1, d2] = [{ chaId: 'D1' }, { chaId: 'D2' }] as unknown as Array<Database['characters'][number]>
        const steps = [
            insertionStep(asDb, host, d2, db.characters[1] as unknown as Database['characters'][number]),
            insertionStep(asDb, host, d1, d2),
            orderVerifyStep(asDb, ['X', 'D1', 'D2', 'S']),
        ]
        expect(applyVerified(steps).result).toBe('applied')
        expect(db.characters.map(slot => slot.chaId)).toEqual(['X', 'D1', 'D2', 'S'])
    })

    test('K3 an insertion whose anchor is not live inserts nothing and fails check A', () => {
        const db = plain('X', 'S')
        const { host } = testHost()
        const held = [...db.characters]
        const stub = { chaId: 'D' } as unknown as Database['characters'][number]
        const ghost = { chaId: 'ghost' } as unknown as Database['characters'][number]
        expect(applyVerified([insertionStep(db as unknown as Database, host, stub, ghost)]).result).toBe('check-failed')
        expect(db.characters.every((slot, index) => slot === held[index])).toBe(true)
        expect(db.characters).toHaveLength(2)
    })
})
