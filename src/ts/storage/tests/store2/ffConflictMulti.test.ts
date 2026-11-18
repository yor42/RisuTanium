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
import { createMemoryBackend, type MemoryBackend } from 'src/ts/storage/store2/backend'
import { isColdStub } from 'src/ts/storage/store2/codec'
import type { FastForwardOutcome } from 'src/ts/storage/store2/fastForward'
import { COMMIT_KEY } from 'src/ts/storage/store2/format/keys'
import { findOrigin, placeRestored, recordTrashOrigins, releaseTrashOrigin } from 'src/ts/trashOrigin'
import { chaIdOf, chars, parsedKey, peerPage, until } from './lineFixtures'
import { bootPageOver, chatsAt, ffSetup, ffTeardown, mergeWorld, peerCommits, personalityOf, resolver, signal, takenBy, type BootedPage, type MergeWorld } from './ffFixtures'
import type { ConflictRecord } from 'src/ts/storage/store2/fastForward'

/**
 * Stage 3C rows that need more than one booted page or a second peer: the answers over several tree hops (P13), the peer's
 * fast-forward over this page's resolution (P11b, P11c, R13b, R13c), the character order a resolution leaves (R21), trash
 * against restore (R23, R24), the same record asked again after a lost compare-and-set (RET8) and the domain judged again in
 * the resolution pass (P11d).
 *
 * The peer that "fast-forwards over the resolution" is a second booted page. Page-global state allows one booted page at a
 * time, so it is booted over a copy of the store as it stood when the peer's tree landed (the page was then at that tree),
 * and the units and commit key this page committed afterwards are copied in before it hears. Trash and restore are the app's
 * field writes through the real `trashOrigin` helpers; the app functions themselves need the whole app and are not run here.
 */

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

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

/** A character trashed as the app does: `trashTime`, its origin record, and no place in the order. */
function trash(db: Database, index: number, at: number): void {
    const slot = chars(db)[index]
    slot.trashTime = at
    recordTrashOrigins(db, [{ chaId: String(slot.chaId) }], at)
    db.characterOrder = db.characterOrder.filter(item => item !== slot.chaId)
}

/** What `restoreCharacterFromTrash` writes: the trash time cleared, the id placed where it was trashed from, the origin released. */
function restore(db: Database, index: number): void {
    const slot = chars(db)[index]
    const chaId = String(slot.chaId)
    const trashedAt = slot.trashTime as number
    const origin = findOrigin(db.trashOrigins, chaId, trashedAt)
    slot.trashTime = undefined
    if (origin !== undefined) {
        placeRestored(db.characterOrder, chaId, origin)
    }
    if (!db.characterOrder.includes(chaId)) {
        db.characterOrder = [...db.characterOrder, chaId]
    }
    releaseTrashOrigin(db, chaId, trashedAt)
}

/** What "Empty trash" writes: the slot is gone and its origin record is pruned with it. */
function emptyTrash(db: Database, index: number): void {
    const id = String(chars(db)[index].chaId)
    ;(db.characters as unknown as Slots).splice(index, 1)
    db.trashOrigins = (db.trashOrigins ?? []).filter(record => record.chaId !== id)
}

/** What the app's permanent delete writes: the slot is gone and `trashOrigins` is left as it was (the next trash action prunes it). */
function deletePermanently(db: Database, index: number): void {
    ;(db.characters as unknown as Slots).splice(index, 1)
}

/** A copy of every entry of the memory store the world runs over. */
function snapshotOf(w: MergeWorld): Map<string, Uint8Array> {
    if (!('snapshot' in w.memory) || typeof w.memory.snapshot !== 'function') {
        throw new Error('The world does not run over a memory store.')
    }
    return (w.memory as MemoryBackend).snapshot()
}

const idsOf = (db: Database): string[] => chars(db).map(slot => String(slot.chaId))
const order = (w: MergeWorld): string[] => idsOf(w.b.db)

/** Waits until the store holds what `holds` accepts (the next own commit of the booted page) and returns it. */
async function storeHolds(w: MergeWorld, holds: (db: Database) => boolean) {
    await until(async () => holds((await w.page.freeze()).db), 'the own commit', 8000)
    return w.page.freeze()
}

/** The peer commits `edit`, the store is copied as it stands then, this page hears it, and the run's outcome is returned. */
async function peerCommitsAt(w: MergeWorld, edit: (db: Database) => void): Promise<{ atTree: Map<string, Uint8Array>, outcome: FastForwardOutcome }> {
    const before = w.run.mock.calls.length
    await w.page.commitEdit(edit)
    const atTree = snapshotOf(w)
    signal(w.world)
    await until(() => w.run.mock.calls.length > before, 'the fast-forward run', 8000)
    return { atTree, outcome: await w.run.mock.results[before].value }
}

/**
 * The peer page: a page booted at `atTree`, the tree it had committed, then handed this page's later commits. This page's
 * loop is stopped first, since the booted-page state is page-global.
 */
async function handOver(w: MergeWorld, atTree: Map<string, Uint8Array>): Promise<BootedPage> {
    const final = snapshotOf(w)
    w.world.stop()
    const memory = createMemoryBackend()
    for (const [key, bytes] of atTree) {
        memory.poke(key, bytes)
    }
    const peer = await bootPageOver(memory)
    for (const [key, bytes] of final) {
        if (key === COMMIT_KEY || !atTree.has(key)) {
            memory.poke(key, bytes)
        }
    }
    return peer
}

async function hears(peer: BootedPage): Promise<FastForwardOutcome> {
    const before = peer.run.mock.calls.length
    signal(peer.world)
    await until(() => peer.run.mock.calls.length > before, 'the peer page\'s fast-forward run', 8000)
    return await peer.run.mock.results[before].value
}

/** The peer page's acknowledged tree is the one this page last committed. */
async function caughtUp(peer: BootedPage, w: MergeWorld): Promise<void> {
    expect(peer.b.context.encoder.manifestKey).toBe((await parsedKey(w.memory)).current?.key)
}

function expectQuiet(peer: BootedPage): void {
    expect(peer.b.peer.asked).toEqual([])
    expect(peer.b.peer.clean).toEqual([])
    expect(peer.world.crashed).toEqual([])
}

describe('the peer fast-forwards over a deleted-against-edited resolution (P11b, P11c, R13b, R13c)', () => {
    test('P11b keep mine for D the peer deleted: the peer page takes this page\'s commit with no park, holds D as a stub where this page lists it, and its selection names the same character', async () => {
        const w = await mergeWorld()
        const { b } = w
        const id = chaIdOf(b.db, 1)
        const selectedId = chaIdOf(b.db, 3)
        resolver(w, () => 'mine')
        chars(b.db)[1].personality = 'mine edit of D'
        const { atTree } = await peerCommitsAt(w, db => remove(db, 1))
        await takenBy(b, w.memory)
        await storeHolds(w, db => idsOf(db).includes(id))
        const bOrder = order(w)
        const bListed = [...b.db.characterOrder]
        const peer = await handOver(w, atTree)
        const peerList = idsOf(peer.b.db)
        expect(peerList).not.toContain(id)
        hostHandle.host.state.selected = peerList.indexOf(selectedId)
        expect((await hears(peer)).kind).toBe('applied')
        expect(idsOf(peer.b.db)).toEqual(bOrder)
        expect(isColdStub(chars(peer.b.db)[bOrder.indexOf(id)])).toBe(true)
        expect(peer.b.db.characterOrder).toEqual(bListed)
        expect(chaIdOf(peer.b.db, hostHandle.host.state.selected ?? -1)).toBe(selectedId)
        expectQuiet(peer)
    })

    test('P11c the peer deleted adjacent D1 and D2, both edited here, both kept: the peer page takes the commit with no park, its order equals this page\'s, and its next commit still holds both', async () => {
        const w = await mergeWorld()
        const { b } = w
        const [d1, d2] = [chaIdOf(b.db, 1), chaIdOf(b.db, 2)]
        const selectedId = chaIdOf(b.db, 3)
        const held = resolver(w, () => 'mine')
        chars(b.db)[1].personality = 'mine edit of D1'
        chars(b.db)[2].personality = 'mine edit of D2'
        const { atTree } = await peerCommitsAt(w, (db) => { remove(db, 1); remove(db, 1) })
        await until(() => held.calls.length === 1, 'the dialog', 8000)
        expect(held.calls[0].map(record => record.id).sort()).toEqual([`char:${d1}:deletedThere`, `char:${d2}:deletedThere`].sort())
        await takenBy(b, w.memory)
        await storeHolds(w, db => idsOf(db).includes(d1) && idsOf(db).includes(d2))
        const bOrder = order(w)
        const peer = await handOver(w, atTree)
        const peerList = idsOf(peer.b.db)
        hostHandle.host.state.selected = peerList.indexOf(selectedId)
        expect((await hears(peer)).kind).toBe('applied')
        expect(idsOf(peer.b.db)).toEqual(bOrder)
        expect(chaIdOf(peer.b.db, hostHandle.host.state.selected ?? -1)).toBe(selectedId)
        expectQuiet(peer)
        // The peer page's own next commit lands, and what it writes still holds both characters in this page's order.
        const before = peer.world.state.saved
        chars(peer.b.db)[0].personality = 'the peer page\'s next edit'
        peer.world.mark(chaIdOf(peer.b.db, 0))
        await until(() => peer.world.state.saved > before, 'the peer page\'s own commit', 8000)
        const read = await w.page.freeze()
        expect(idsOf(read.db)).toEqual(bOrder)
        expect(read.db.characterOrder).toEqual(peer.b.db.characterOrder)
    })

    test('R13b this page deleted D the peer edited and keeps theirs: its order equals the peer\'s, and the peer page takes the commit that follows with no change to D and no park', async () => {
        const w = await mergeWorld()
        const { b } = w
        const id = chaIdOf(b.db, 1)
        // Held so this page cannot commit its own tree before the peer's order is read from the store.
        const held = resolver(w, () => undefined, { held: true })
        remove(b.db, 1)
        const { atTree } = await peerCommitsAt(w, (db) => { chars(db)[1].personality = 'peer edit of D' })
        const peerOrder = idsOf((await w.page.freeze()).db)
        held.release()
        await takenBy(b, w.memory)
        expect(order(w)).toEqual(peerOrder)
        chars(b.db)[0].personality = 'this page\'s next edit'
        w.world.mark(chaIdOf(b.db, 0))
        await storeHolds(w, db => personalityOf(db, 0) === 'this page\'s next edit')
        const bListed = [...b.db.characterOrder]
        const peer = await handOver(w, atTree)
        expect((await hears(peer)).kind).toBe('applied')
        expect(idsOf(peer.b.db)).toEqual(peerOrder)
        expect(personalityOf(peer.b.db, peerOrder.indexOf(id))).toBe('peer edit of D')
        expect(peer.b.db.characterOrder).toEqual(bListed)
        await caughtUp(peer, w)
        expectQuiet(peer)
    })

    test('R13c this page deleted adjacent D and D2, the peer edited both; keep theirs for D and keep mine for D2: D returns before D2\'s old successor, D2 stays deleted, and the peer page takes the removal of D2 with no park', async () => {
        const w = await mergeWorld()
        const { b } = w
        const [d, d2] = [chaIdOf(b.db, 1), chaIdOf(b.db, 2)]
        // Held so this page cannot commit its own tree before the peer's order is read from the store.
        const held = resolver(w, record => record.id.includes(d2) ? 'mine' : 'theirs', { held: true })
        remove(b.db, 1)
        remove(b.db, 1)
        const { atTree } = await peerCommitsAt(w, (db) => {
            chars(db)[1].personality = 'peer edit of D'
            chars(db)[2].personality = 'peer edit of D2'
        })
        const peerOrder = idsOf((await w.page.freeze()).db)
        held.release()
        await takenBy(b, w.memory)
        expect(held.calls[0].map(record => record.id).sort()).toEqual([`char:${d}:deletedHere`, `char:${d2}:deletedHere`].sort())
        expect(order(w)).toEqual(peerOrder.filter(item => item !== d2))
        chars(b.db)[0].personality = 'this page\'s next edit'
        w.world.mark(chaIdOf(b.db, 0))
        await storeHolds(w, db => personalityOf(db, 0) === 'this page\'s next edit')
        const bOrder = order(w)
        const peer = await handOver(w, atTree)
        expect(idsOf(peer.b.db)).toEqual(peerOrder)
        expect((await hears(peer)).kind).toBe('applied')
        expect(idsOf(peer.b.db)).toEqual(bOrder)
        expect(idsOf(peer.b.db)).not.toContain(d2)
        expectQuiet(peer)
    })
})

describe('the character order a resolution leaves (R21 (ii), (iii))', () => {
    test('R21 (ii) keep theirs for a character this page deleted: it is listed at the end of the top-level order', async () => {
        const w = await mergeWorld()
        const { b } = w
        const id = chaIdOf(b.db, 1)
        resolver(w, () => 'theirs')
        remove(b.db, 1)
        await peerCommits(w, (db) => { chars(db)[1].personality = 'peer edit of D' })
        await takenBy(b, w.memory)
        const named = b.db.characterOrder.filter((item): item is string => typeof item === 'string')
        expect(named[named.length - 1]).toBe(id)
    })

    /** Trashed D (index 1) that this page edited and the peer removed from the trash. */
    async function keepMineOverEmptiedTrash(peerDeletes: (db: Database, index: number) => void = emptyTrash): Promise<{ w: MergeWorld, id: string, at: number, listedBefore: Array<string | object> }> {
        const at = Date.now()
        const w = await mergeWorld({ before: async (page) => { await page.commitEdit((db) => { trash(db, 1, at) }) } })
        const { b } = w
        const id = chaIdOf(b.db, 1)
        const listedBefore = [...b.db.characterOrder]
        expect(b.db.trashOrigins?.some(record => record.chaId === id)).toBe(true)
        resolver(w, () => 'mine')
        chars(b.db)[1].personality = 'mine edit of trashed D'
        await peerCommits(w, db => peerDeletes(db, 1))
        await takenBy(b, w.memory)
        return { w, id, at, listedBefore }
    }

    test('R21 (iii) keep mine for a trashed D the peer removed from the trash: D stays trashed and the order is unchanged, here and in the next commit', async () => {
        const { w, id, at, listedBefore } = await keepMineOverEmptiedTrash()
        expect(order(w)).toContain(id)
        expect(chars(w.b.db)[1].trashTime).toBe(at)
        expect(w.b.db.characterOrder).toEqual(listedBefore)
        const read = await storeHolds(w, db => idsOf(db).includes(id))
        expect(chars(read.db)[idsOf(read.db).indexOf(id)].trashTime).toBe(at)
        expect(read.db.characterOrder).toEqual(listedBefore)
    })

    // Here the peer's tree no longer holds the origin record of D's trashing (the peer pruned it with the removal), so the
    // trashOrigins three-way drops it; a later restore of D lands at the top-level end of the order.
    test('R21 (iii-b) keep mine for a trashed D the peer removed and whose origin record the peer pruned: the origin record of that trashing is absent', async () => {
        const { w, id } = await keepMineOverEmptiedTrash()
        expect(w.b.db.trashOrigins?.some(record => record.chaId === id) ?? false).toBe(false)
    })

    test('R21 (iii-c) keep mine for a trashed D the peer permanently deleted without pruning trashOrigins: D stays trashed and its origin record is kept', async () => {
        const { w, id, at, listedBefore } = await keepMineOverEmptiedTrash(deletePermanently)
        expect(order(w)).toContain(id)
        expect(chars(w.b.db)[1].trashTime).toBe(at)
        expect(w.b.db.characterOrder).toEqual(listedBefore)
        expect(w.b.db.trashOrigins?.some(record => record.chaId === id) ?? false).toBe(true)
    })
})
describe('trash against restore (R23, R24)', () => {
    /** D (index 1) is trashed in the shared base. */
    const trashedWorld = (at: number): Promise<MergeWorld> => mergeWorld({ before: async (page) => { await page.commitEdit((db) => { trash(db, 1, at) }) } })

    test('R23 keep mine: this page restored D, the peer emptied the trash; D is asked about, stays untrashed and listed, and the peer page takes this page\'s commit with no park', async () => {
        const w = await trashedWorld(Date.now())
        const { b } = w
        const id = chaIdOf(b.db, 1)
        const held = resolver(w, () => 'mine')
        restore(b.db, 1)
        const { atTree } = await peerCommitsAt(w, db => emptyTrash(db, 1))
        await until(() => held.calls.length === 1, 'the dialog', 8000)
        expect(held.calls[0]).toHaveLength(1)
        expect(held.calls[0][0]).toMatchObject({ id: `char:${id}:deletedThere`, choices: ['mine', 'theirs'], keepBoth: null, preselect: 'mine' })
        await takenBy(b, w.memory)
        expect(order(w)).toContain(id)
        expect(chars(b.db)[1].trashTime).toBeUndefined()
        expect(b.db.characterOrder).toContain(id)
        await storeHolds(w, db => idsOf(db).includes(id) && chars(db)[idsOf(db).indexOf(id)].trashTime === undefined)
        const bOrder = order(w)
        const bListed = [...b.db.characterOrder]
        const peer = await handOver(w, atTree)
        expect(idsOf(peer.b.db)).not.toContain(id)
        expect((await hears(peer)).kind).toBe('applied')
        expect(idsOf(peer.b.db)).toEqual(bOrder)
        expect(peer.b.db.characterOrder).toEqual(bListed)
        expectQuiet(peer)
    })

    test('R23 keep theirs: D is removed here and no commit puts it back', async () => {
        const w = await trashedWorld(Date.now())
        const { b } = w
        const id = chaIdOf(b.db, 1)
        const held = resolver(w, () => 'theirs')
        restore(b.db, 1)
        await peerCommits(w, db => emptyTrash(db, 1))
        await takenBy(b, w.memory)
        expect(held.calls).toHaveLength(1)
        expect(order(w)).not.toContain(id)
        chars(b.db)[0].personality = 'a later edit'
        w.world.mark(chaIdOf(b.db, 0))
        const read = await storeHolds(w, db => personalityOf(db, 0) === 'a later edit')
        expect(idsOf(read.db)).not.toContain(id)
    })

    test('R24 keep theirs: the peer restored D, this page emptied the trash; D comes back untrashed at the peer\'s place, the order is the peer\'s, and the peer page takes this page\'s commit with no park', async () => {
        const w = await trashedWorld(Date.now())
        const { b } = w
        const id = chaIdOf(b.db, 1)
        // Held so this page cannot commit its own tree before the peer's order is read from the store.
        const held = resolver(w, () => 'theirs', { held: true })
        emptyTrash(b.db, 1)
        const { atTree } = await peerCommitsAt(w, db => restore(db, 1))
        const peerListed = (await w.page.freeze()).db.characterOrder
        await until(() => held.calls.length === 1, 'the dialog', 8000)
        expect(held.calls[0]).toHaveLength(1)
        expect(held.calls[0][0]).toMatchObject({ id: `char:${id}:deletedHere`, choices: ['mine', 'theirs'], keepBoth: null, preselect: 'theirs' })
        held.release()
        await takenBy(b, w.memory)
        const at = order(w).indexOf(id)
        expect(at).toBeGreaterThanOrEqual(0)
        expect(isColdStub(chars(b.db)[at])).toBe(true)
        expect(chars(b.db)[at].trashTime).toBeUndefined()
        expect(b.db.characterOrder).toEqual(peerListed)
        expect(b.db.characterOrder).toContain(id)
        chars(b.db)[0].personality = 'this page\'s next edit'
        w.world.mark(chaIdOf(b.db, 0))
        await storeHolds(w, db => personalityOf(db, 0) === 'this page\'s next edit')
        const bOrder = order(w)
        const peer = await handOver(w, atTree)
        expect((await hears(peer)).kind).toBe('applied')
        expect(idsOf(peer.b.db)).toEqual(bOrder)
        expectQuiet(peer)
    })

    test('R24 keep mine: D stays deleted, and the order entry taken from the peer names a character this page does not hold', async () => {
        const w = await trashedWorld(Date.now())
        const { b } = w
        const id = chaIdOf(b.db, 1)
        const held = resolver(w, () => 'mine')
        emptyTrash(b.db, 1)
        await peerCommits(w, db => restore(db, 1))
        await takenBy(b, w.memory)
        expect(held.calls).toHaveLength(1)
        expect(order(w)).not.toContain(id)
        expect(b.db.characterOrder).toContain(id)
        expect(w.world.crashed).toEqual([])
    })
})

describe('the answers over several hops and a lost compare-and-set (P13, RET8)', () => {
    const answered = [
        {
            name: 'card',
            record: (chaId: string, _cid: string) => `char:${chaId}:core`,
            write: (db: Database, text: string) => { chars(db)[3].personality = text },
            read: (db: Database) => personalityOf(db, 3),
        },
        {
            name: 'chat',
            record: (chaId: string, cid: string) => `char:${chaId}:chat:${cid}`,
            write: (db: Database, text: string) => { chatsAt(db, 3)[0].note = text },
            read: (db: Database) => chatsAt(db, 3)[0].note,
        },
    ]

    test.each(answered)('P13 ($name) a third page commits a change to the answered record while the dialog is open: the record is asked again with the new fingerprint, and the peer page takes both commits with no park', async ({ record, write, read }) => {
        const w = await mergeWorld()
        const { b } = w
        const chaId = chaIdOf(b.db, 3)
        const cid = String(chatsAt(b.db, 3)[0].id)
        const third = peerPage(w.memory, w.clock, 31, 'page-c')
        const calls: ConflictRecord[][] = []
        let release: () => void = () => { }
        const open = new Promise<void>((resolve) => { release = resolve })
        b.peer.resolve = async ({ conflicts }) => {
            calls.push([...conflicts])
            if (calls.length === 1) {
                await open
            }
            return Object.fromEntries(conflicts.map(row => [row.id, 'theirs' as const]))
        }
        write(b.db, 'mine')
        const { atTree } = await peerCommitsAt(w, (db) => { write(db, 'peer') })
        await until(() => calls.length === 1, 'the first dialog', 8000)
        const reads = vi.spyOn(b.context.session.committer, 'readCommit')
        await third.commitEdit((db) => { write(db, 'third page') })
        signal(w.world)
        // The dialog stays open until the loop has re-judged the third page's descending commit: the park must stand over it.
        await until(() => reads.mock.calls.length > 0, 'the loop re-reading the third page\'s commit', 8000)
        await Promise.all(reads.mock.results.map(result => result.value))
        await new Promise<void>(resolve => setTimeout(resolve, 100))
        expect(b.peer.asked).toEqual([])
        expect(b.peer.clean).toEqual([])
        expect(calls).toHaveLength(1)
        release()
        await until(() => calls.length === 2, 'the second dialog', 8000)
        expect(calls[1].map(row => row.id)).toEqual([record(chaId, cid)])
        expect(calls[1][0].fingerprint.theirs).not.toBe(calls[0][0].fingerprint.theirs)
        await takenBy(b, w.memory)
        expect(read(b.db)).toBe('third page')
        chars(b.db)[0].personality = 'this page\'s next edit'
        w.world.mark(chaIdOf(b.db, 0))
        await storeHolds(w, db => personalityOf(db, 0) === 'this page\'s next edit')
        const peer = await handOver(w, atTree)
        expect(read(peer.b.db)).toBe('peer')
        expect((await hears(peer)).kind).toBe('applied')
        await caughtUp(peer, w)
        expectQuiet(peer)
    })
    test('RET8 the compare-and-set loses after a keep-both resolution: the restore point is still owed, the descendant is admitted once by the commit that lands, and a later commit asks for nothing', async () => {
        const w = await mergeWorld()
        const { b } = w
        const committer = b.context.session.committer
        const real = committer.commit.bind(committer)
        const asked: Array<boolean | undefined> = []
        let injected = false
        let descendant: Awaited<ReturnType<typeof parsedKey>> | null = null
        vi.spyOn(committer, 'commit').mockImplementation(async (read, request) => {
            asked.push(request.keepPrevious)
            if (!injected) {
                injected = true
                // A peer commit lands between this page's read and its compare-and-set, so the commit is lost.
                await w.page.commitEdit((db) => { chars(db)[1].personality = 'second peer commit' })
                descendant = await parsedKey(w.memory)
                signal(w.world)
            }
            return real(read, request)
        })
        resolver(w)
        chars(b.db)[3].personality = 'mine card'
        w.world.state.dirty = true
        await peerCommits(w, (db) => { chars(db)[3].personality = 'peer card' })
        await until(() => asked.length >= 2, 'the commit after the lost one', 8000)
        await until(async () => {
            const key = await parsedKey(w.memory)
            return descendant !== null && key.current?.key !== descendant.current?.key
        }, 'the landing', 8000)
        const landed = await parsedKey(w.memory)
        expect(asked[0]).toBe(true)
        expect(asked[1]).toBe(true)
        expect(descendant).not.toBeNull()
        // One admission: the descendant the landing commit was built on, once.
        expect(landed.retained[0].key).toBe(descendant?.current?.key)
        expect(landed.retained.length).toBe((descendant?.retained.length ?? 0) + 1)
        const frozen = await w.page.freeze()
        expect(personalityOf(frozen.db, 3)).toBe('mine card')
        expect(personalityOf(frozen.db, 1)).toBe('second peer commit')
        const count = asked.length
        chars(b.db)[0].personality = 'a later edit'
        w.world.mark(chaIdOf(b.db, 0))
        await until(() => asked.length > count, 'the later own commit', 8000)
        expect(asked.slice(count)).not.toContain(true)
    })
})

describe('the domain is judged again in the resolution pass (P11d)', () => {
    test('P11d the answer to a deleted-against-edited D is given and, before the pass that applies it, the peer commits a character sharing an existing chaId: the pass judges the domain again, parks membership:not-append, and D\'s answer is not applied', async () => {
        const w = await mergeWorld()
        const { b } = w
        const id = chaIdOf(b.db, 1)
        const shared = chaIdOf(b.db, 0)
        const calls: ConflictRecord[][] = []
        b.peer.resolve = async ({ conflicts }) => {
            calls.push([...conflicts])
            // The person answers keep mine, and the peer's next commit lands before the pass that applies the answer.
            await w.page.commitEdit((db) => {
                const added = JSON.parse(JSON.stringify(chars(db)[0])) as Record<string, unknown>
                added.chaId = shared
                added.name = 'Shares a chaId'
                ;(db.characters as unknown as Slots).push(added)
            })
            signal(w.world)
            return Object.fromEntries(conflicts.map(record => [record.id, 'mine' as const]))
        }
        chars(b.db)[1].personality = 'mine edit of D'
        await peerCommits(w, db => remove(db, 1))
        await until(() => calls.length === 1, 'the dialog', 8000)
        expect(calls[0].map(record => record.id)).toEqual([`char:${id}:deletedThere`])
        const outcomes = async (): Promise<FastForwardOutcome[]> => await Promise.all(w.run.mock.results.map(result => result.value as Promise<FastForwardOutcome>))
        await until(async () => (await outcomes()).some(outcome => outcome.kind === 'park' && outcome.reason === 'membership:not-append'), 'the park outside the domain', 8000)
        // The pass that carried the answer is the one that parked: no later run applied it.
        expect((await outcomes()).some(outcome => outcome.kind === 'applied')).toBe(false)
        expect(calls).toHaveLength(1)
        expect(order(w)).toContain(id)
        expect(personalityOf(b.db, order(w).indexOf(id))).toBe('mine edit of D')
        expect(w.world.crashed).toEqual([])
    })

    test('P11d (out of domain) the peer appends two characters sharing a new chaId before the answer applies: the pass judges the domain again and parks membership:not-append, not a later check', async () => {
        const w = await mergeWorld()
        const { b } = w
        const id = chaIdOf(b.db, 1)
        const calls: ConflictRecord[][] = []
        b.peer.resolve = async ({ conflicts }) => {
            calls.push([...conflicts])
            await w.page.commitEdit((db) => {
                for (const name of ['First', 'Second']) {
                    const added = JSON.parse(JSON.stringify(chars(db)[0])) as Record<string, unknown>
                    added.chaId = 'shared-new-id'
                    added.name = `${name} sharing a new chaId`
                    ;(db.characters as unknown as Slots).push(added)
                }
            })
            signal(w.world)
            return Object.fromEntries(conflicts.map(record => [record.id, 'mine' as const]))
        }
        chars(b.db)[1].personality = 'mine edit of D'
        await peerCommits(w, db => remove(db, 1))
        await until(() => calls.length === 1, 'the dialog', 8000)
        const outcomes = async (): Promise<FastForwardOutcome[]> => await Promise.all(w.run.mock.results.map(result => result.value as Promise<FastForwardOutcome>))
        await until(async () => (await outcomes()).some(outcome => outcome.kind === 'park' && outcome.reason === 'membership:not-append'), 'the park outside the domain', 8000)
        expect((await outcomes()).some(outcome => outcome.kind === 'applied')).toBe(false)
        expect(order(w)).toContain(id)
        expect(w.world.crashed).toEqual([])
    })
})
