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
import { beginWork, writingTargets } from 'src/ts/process/chatOrigin'
import { DBState } from 'src/ts/stores.svelte'
import { chaIdOf, chars, until } from './lineFixtures'
import { chatsAt, ffSetup, ffTeardown, mergeWorld, personalityOf, signal, type MergeWorld } from './ffFixtures'

/**
 * The wait rule of stage 3B. A record the peer changed that a send writes waits for the send (`d1w`), whatever the
 * decision; everything else applies mid-send. LABEL: the send is simulated by the host's writing set (the host that the
 * real page builds from `writingTargets`), not by the real `sendChat` with a stepped provider stream, so these rows are
 * diagnostics that stay as a cheap second form of the real-send rows in `ffMergeSendReal.test.ts`; `writingTargets`
 * itself is tested against the real registrations below.
 */

let hostHandle: ReturnType<typeof ffSetup>

beforeEach(() => {
    hostHandle = ffSetup()
})

afterEach(() => {
    ffTeardown()
    vi.useRealTimers()
})

const state = (): ReturnType<typeof ffSetup>['host']['state'] => hostHandle.host.state

/** Marks `index` as being written into chat `chatIndex`: the character is in use and in the host's writing set. */
function writing(w: MergeWorld, index: number, chatIndex: number): { chaId: string, cid: string } {
    const chaId = chaIdOf(w.b.db, index)
    const cid = String(chatsAt(w.b.db, index)[chatIndex].id)
    state().inUse.add(chaId)
    state().writing.add(chaId)
    state().writingChats = new Map([[chaId, new Set([cid])]])
    return { chaId, cid }
}

function endSend(): void {
    state().writing.clear()
    state().writingChats = new Map()
}

/** The peer commits and the page hears it; resolves with the index of the run that started. */
async function peerEdits(w: MergeWorld, edit: (db: Database) => void): Promise<number> {
    const index = w.run.mock.calls.length
    await w.page.commitEdit(edit)
    signal(w.world)
    await until(() => w.run.mock.calls.length > index, 'the fast-forward run', 8000)
    return index
}

const resultOf = (w: MergeWorld, index: number): Promise<{ kind: string, reason?: string }> => w.run.mock.results[index].value as Promise<{ kind: string, reason?: string }>

describe('what a send writes waits, the rest applies (R-SEND rows, simulated writer)', () => {
    test('R-SEND1 the peer commits chat Y of the character being written into X: Y applies before the send ends, X is untouched and nobody is asked', async () => {
        const w = await mergeWorld()
        const { cid } = writing(w, 3, 0)
        const x = chatsAt(w.b.db, 3)[0]
        x.note = 'reply in progress'
        const index = await peerEdits(w, (db) => { chatsAt(db, 3)[1].note = 'peer y note' })
        expect(await resultOf(w, index)).toEqual({ kind: 'applied' })
        expect(chatsAt(w.b.db, 3)[1].note).toBe('peer y note')
        expect(chatsAt(w.b.db, 3)[0]).toBe(x)
        expect(x.note).toBe('reply in progress')
        expect(String(x.id)).toBe(cid)
        expect(w.b.peer.asked).toEqual([])
        expect(w.b.peer.clean).toEqual([])
    })

    test('R-SEND2 the peer edits the written chat X: nothing applies and nobody is asked until the send ends, then the conflict parks with today\'s prompt', async () => {
        const w = await mergeWorld()
        const { chaId, cid } = writing(w, 3, 0)
        chatsAt(w.b.db, 3)[0].note = 'the reply'
        const index = await peerEdits(w, (db) => { chatsAt(db, 3)[0].note = 'peer edit of x' })
        expect((await resultOf(w, index)).kind).toBe('deferred')
        expect(chatsAt(w.b.db, 3)[0].note).toBe('the reply')
        expect(w.b.peer.asked).toEqual([])
        expect(w.b.peer.clean).toEqual([])
        endSend()
        await until(() => w.run.mock.calls.length > index + 1, 'the run after the send', 8000)
        expect(await resultOf(w, index + 1)).toEqual({ kind: 'park', reason: `conflict:char:${chaId}:chat:${cid}` })
        expect(chatsAt(w.b.db, 3)[0].note).toBe('the reply')
    })

    test('R-SEND3 the peer prepends a chat while X is written: X keeps its object and moves to index 1', async () => {
        const w = await mergeWorld()
        writing(w, 3, 0)
        const x = chatsAt(w.b.db, 3)[0]
        const index = await peerEdits(w, (db) => {
            const chats = chatsAt(db, 3)
            chats.unshift({ ...JSON.parse(JSON.stringify(chats[0])) as Record<string, unknown>, id: 'copy-by-peer', name: 'Copy' })
            chars(db)[3].chatPage = 1
        })
        expect(await resultOf(w, index)).toEqual({ kind: 'applied' })
        expect(chatsAt(w.b.db, 3)[1]).toBe(x)
        expect(chatsAt(w.b.db, 3)[0].id).toBe('copy-by-peer')
    })

    test('R-SEND4 the peer edits the card of the character that is sent in: the card waits until the end, then it is taken', async () => {
        const w = await mergeWorld()
        writing(w, 3, 0)
        const index = await peerEdits(w, (db) => { chars(db)[3].personality = 'peer card' })
        expect((await resultOf(w, index)).kind).toBe('deferred')
        expect(personalityOf(w.b.db, 3)).not.toBe('peer card')
        endSend()
        await until(() => w.run.mock.calls.length > index + 1, 'the run after the send', 8000)
        expect(await resultOf(w, index + 1)).toEqual({ kind: 'applied' })
        expect(personalityOf(w.b.db, 3)).toBe('peer card')
    })

    test('R-SEND5 the peer permanently deletes the character being written into: it stays until the end, then B\'s reply edit makes it a deletedThere conflict', async () => {
        const w = await mergeWorld()
        const { chaId } = writing(w, 1, 0)
        chatsAt(w.b.db, 1)[0].note = 'the reply'
        const index = await peerEdits(w, (db) => {
            const id = chaIdOf(db, 1)
            ;(db.characters as unknown as unknown[]).splice(1, 1)
            db.characterOrder = db.characterOrder.filter(item => item !== id)
        })
        expect((await resultOf(w, index)).kind).toBe('deferred')
        expect(chaIdOf(w.b.db, 1)).toBe(chaId)
        endSend()
        await until(() => w.run.mock.calls.length > index + 1, 'the run after the send', 8000)
        expect(await resultOf(w, index + 1)).toEqual({ kind: 'park', reason: `conflict:char:${chaId}:deletedThere` })
        expect(chaIdOf(w.b.db, 1)).toBe(chaId)
    })

    test('R-SEND6 the peer deletes a member of the group being written: it stays until the end, then it is removed', async () => {
        const w = await mergeWorld()
        const member = chaIdOf(w.b.db, 1)
        const group = chaIdOf(w.b.db, 3)
        state().writing.add(group)
        state().writing.add(member)
        const index = await peerEdits(w, (db) => {
            ;(db.characters as unknown as unknown[]).splice(1, 1)
            db.characterOrder = db.characterOrder.filter(item => item !== member)
        })
        expect((await resultOf(w, index)).kind).toBe('deferred')
        expect(chaIdOf(w.b.db, 1)).toBe(member)
        endSend()
        await until(() => w.run.mock.calls.length > index + 1, 'the run after the send', 8000)
        expect(await resultOf(w, index + 1)).toEqual({ kind: 'applied' })
        expect(chars(w.b.db).map(slot => String(slot.chaId))).not.toContain(member)
    })

    test('R6b a character whose only chat has no id is a whole record: a card change waits for the send and is taken after it', async () => {
        const w = await mergeWorld({ before: async (page) => { await page.commitEdit((db) => { chatsAt(db, 3)[0].id = '' }) } })
        state().inUse.add(chaIdOf(w.b.db, 3))
        state().writing.add(chaIdOf(w.b.db, 3))
        const written = chatsAt(w.b.db, 3)[0]
        const index = await peerEdits(w, (db) => { chars(db)[3].personality = 'peer card' })
        expect((await resultOf(w, index)).kind).toBe('deferred')
        expect(personalityOf(w.b.db, 3)).not.toBe('peer card')
        endSend()
        await until(() => w.run.mock.calls.length > index + 1, 'the run after the send', 8000)
        expect(await resultOf(w, index + 1)).toEqual({ kind: 'applied' })
        expect(chatsAt(w.b.db, 3)[0]).toBe(written)
    })
})

describe('writingTargets reads the real registrations', () => {
    function install(slots: Array<Record<string, unknown>>): void {
        ;(DBState as unknown as { db: { characters: unknown[] } }).db = { characters: slots }
    }

    test('an owner and its chat are reported, the work ending clears them', () => {
        const owner = { chaId: 'owner', chats: [{ id: 'chat-1' }] }
        install([owner])
        const handle = beginWork(owner as never, owner.chats[0] as never)
        expect(handle).not.toBeNull()
        const during = writingTargets()
        expect([...during.chars]).toEqual(['owner'])
        expect([...(during.chats.get('owner') ?? [])]).toEqual(['chat-1'])
        handle?.end()
        expect(writingTargets().chars.size).toBe(0)
        expect(writingTargets().chats.size).toBe(0)
    })

    test('every member of a group owner and a speaking member are reported', () => {
        const group = { chaId: 'group', type: 'group', characters: ['m1', 'm2'], chats: [{ id: 'g-chat' }] }
        const m1 = { chaId: 'm1', chats: [{ id: 'm-chat' }] }
        const m2 = { chaId: 'm2', chats: [] }
        install([group, m1, m2])
        const handle = beginWork(group as never, group.chats[0] as never, m1 as never)
        const targets = writingTargets()
        expect([...targets.chars].sort()).toEqual(['group', 'm1', 'm2'])
        expect([...(targets.chats.get('group') ?? [])]).toEqual(['g-chat'])
        handle?.end()
    })
})
